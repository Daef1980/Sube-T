const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// ─── Cliente de Mercado Pago ───────────────────────────────────────────────
// Guarda tu Access Token en Firebase config:
//   firebase functions:config:set mp.access_token="APP_USR-xxxx..."
const mpClient = new MercadoPagoConfig({
  accessToken: functions.config().mp.access_token,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. CREAR PREFERENCIA DE PAGO
//    Llamada desde el frontend cuando el cliente confirma la reserva.
//    Recibe los datos de la reserva, crea un documento en Firestore con
//    estado "pendiente" y devuelve el init_point (link de pago de MP).
// ─────────────────────────────────────────────────────────────────────────────
exports.crearPago = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    try {
      const {
        folio,
        nombre,
        email,       // opcional pero recomendado para MP
        tel,
        ruta,
        fecha,
        horario,
        unidadId,
        unidadNombre,
        placa,
        conductorId,
        conductorNombre,
        conductorClabe,
        conductorBanco,
        lugar,
        personas,
        metodoPago,   // "spei" | "efectivo"
      } = req.body;

      // Validación mínima
      if (!folio || !nombre || !ruta || !fecha || !horario || !unidadId) {
        return res.status(400).json({ error: "Faltan datos de la reserva" });
      }

      const deposito = 100;
      const saldo = 250;
      const total = deposito + saldo;
      const expiraEn = Date.now() + 30 * 60 * 1000; // 30 min

      // Guardar reserva en Firestore con estado "pendiente"
      await db.collection("reservas").doc(folio).set({
        folio,
        nombre,
        email: email || "",
        tel,
        ruta,
        fecha,
        horario,
        unidadId,
        unidadNombre,
        placa,
        conductorId: conductorId || "",
        conductorNombre: conductorNombre || "",
        conductorClabe: conductorClabe || "",
        conductorBanco: conductorBanco || "",
        lugar,
        personas,
        deposito,
        saldo,
        total,
        metodoPago,
        estado: "pendiente",         // pendiente | confirmada | abordado | cancelada | expirada
        saldoEstado: "pendiente",    // pendiente | liquidado
        expiraEn,
        creadaEn: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Crear preferencia en Mercado Pago
      const preference = new Preference(mpClient);
      const response = await preference.create({
        body: {
          external_reference: folio,   // así identificamos la reserva en el webhook
          items: [
            {
              id: folio,
              title: `Sube · ${ruta === "MCL" ? "Monclova → Monterrey" : "Monterrey → Monclova"}`,
              description: `${fecha} · ${horario} · Lugar #${lugar} · ${nombre}`,
              quantity: 1,
              unit_price: deposito,
              currency_id: "MXN",
            },
          ],
          payer: {
            name: nombre,
            phone: { number: tel },
          },
          back_urls: {
            success: `https://TU_DOMINIO.com/pago-exitoso?folio=${folio}`,
            failure: `https://TU_DOMINIO.com/pago-fallido?folio=${folio}`,
            pending: `https://TU_DOMINIO.com/pago-pendiente?folio=${folio}`,
          },
          auto_return: "approved",
          notification_url: `https://TU_REGION-TU_PROYECTO.cloudfunctions.net/webhookPago`,
          expires: true,
          expiration_date_to: new Date(expiraEn).toISOString(),
          statement_descriptor: "SUBE TRANSPORTES",
          payment_methods: {
            excluded_payment_types: [],   // aqui puedes excluir métodos si quieres
            installments: 1,              // sin meses sin intereses
          },
        },
      });

      // Guardar el preference_id en Firestore para referencia
      await db.collection("reservas").doc(folio).update({
        mpPreferenceId: response.id,
      });

      return res.status(200).json({
        preferenceId: response.id,
        initPoint: response.init_point,         // producción
        sandboxInitPoint: response.sandbox_init_point, // pruebas
      });

    } catch (error) {
      console.error("Error crearPago:", error);
      return res.status(500).json({ error: "Error al crear el pago", detalle: error.message });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WEBHOOK DE MERCADO PAGO
//    MP llama a esta URL automáticamente cuando el pago cambia de estado.
//    Aquí confirmamos la reserva o la marcamos como fallida.
// ─────────────────────────────────────────────────────────────────────────────
exports.webhookPago = functions.https.onRequest(async (req, res) => {
  // MP espera 200 rápido, luego procesamos
  res.status(200).send("OK");

  try {
    const { type, data } = req.body;

    // Solo nos interesan notificaciones de pago
    if (type !== "payment") return;

    const paymentId = data?.id;
    if (!paymentId) return;

    // Consultar el pago en MP para verificarlo
    const payment = new Payment(mpClient);
    const pagoInfo = await payment.get({ id: paymentId });

    const folio = pagoInfo.external_reference;
    const status = pagoInfo.status;          // approved | pending | rejected | cancelled
    const statusDetail = pagoInfo.status_detail;

    console.log(`Webhook pago ${paymentId} · folio ${folio} · status: ${status} (${statusDetail})`);

    if (!folio) return;

    const resRef = db.collection("reservas").doc(folio);
    const resDoc = await resRef.get();
    if (!resDoc.exists) {
      console.error(`Reserva ${folio} no encontrada`);
      return;
    }

    if (status === "approved") {
      // ✅ Pago aprobado → confirmar lugar
      await resRef.update({
        estado: "confirmada",
        mpPaymentId: paymentId,
        mpStatus: status,
        mpStatusDetail: statusDetail,
        pagadoEn: admin.firestore.FieldValue.serverTimestamp(),
        expiraEn: null,   // ya no expira
      });

      // Opcional: registrar en colección de pagos para auditoría
      await db.collection("pagos").add({
        folio,
        paymentId,
        monto: pagoInfo.transaction_amount,
        status,
        statusDetail,
        fecha: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Reserva ${folio} CONFIRMADA`);

    } else if (["rejected", "cancelled"].includes(status)) {
      // ❌ Pago rechazado → liberar lugar
      await resRef.update({
        estado: "cancelada",
        mpPaymentId: paymentId,
        mpStatus: status,
        mpStatusDetail: statusDetail,
      });
      console.log(`❌ Reserva ${folio} CANCELADA (pago ${status})`);

    } else if (status === "pending") {
      // ⏳ OXXO u otros métodos que tardan
      await resRef.update({
        mpPaymentId: paymentId,
        mpStatus: status,
        mpStatusDetail: statusDetail,
      });
      console.log(`⏳ Reserva ${folio} pago PENDIENTE`);
    }

  } catch (error) {
    console.error("Error webhookPago:", error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. VERIFICAR ESTADO DE RESERVA
//    El frontend la consulta después de que MP redirige al cliente de vuelta.
//    Así mostramos el folio si el pago fue aprobado.
// ─────────────────────────────────────────────────────────────────────────────
exports.estadoReserva = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const folio = req.query.folio;
    if (!folio) return res.status(400).json({ error: "Falta el folio" });

    try {
      const doc = await db.collection("reservas").doc(folio).get();
      if (!doc.exists) return res.status(404).json({ error: "Reserva no encontrada" });

      const data = doc.data();
      return res.status(200).json({
        folio: data.folio,
        estado: data.estado,
        nombre: data.nombre,
        ruta: data.ruta,
        fecha: data.fecha,
        horario: data.horario,
        unidadNombre: data.unidadNombre,
        lugar: data.lugar,
        personas: data.personas,
        deposito: data.deposito,
        saldo: data.saldo,
        metodoPago: data.metodoPago,
        conductorNombre: data.conductorNombre,
        conductorClabe: data.conductorClabe,
        conductorBanco: data.conductorBanco,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPIRAR RESERVAS PENDIENTES (cron cada 5 minutos)
//    Libera automáticamente los lugares de reservas que no pagaron a tiempo.
// ─────────────────────────────────────────────────────────────────────────────
exports.expirarReservas = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const ahora = Date.now();
    const snap = await db
      .collection("reservas")
      .where("estado", "==", "pendiente")
      .where("expiraEn", "<=", ahora)
      .get();

    if (snap.empty) return null;

    const batch = db.batch();
    snap.forEach((doc) => {
      batch.update(doc.ref, { estado: "expirada" });
      console.log(`⏰ Reserva ${doc.id} expirada`);
    });
    await batch.commit();
    console.log(`${snap.size} reservas expiradas`);
    return null;
  });
