// ─────────────────────────────────────────────────────────────────────────────
// sube-mercadopago.js
// Módulo frontend: crea la preferencia llamando a tu Cloud Function
// y redirige al cliente a la pantalla de pago de Mercado Pago.
//
// MODO SANDBOX vs PRODUCCIÓN:
//   Cambia SUBE_ENV a "production" cuando estés listo para cobrar de verdad.
// ─────────────────────────────────────────────────────────────────────────────

const SUBE_CONFIG = {
  // URL base de tus Cloud Functions
  // En desarrollo local: "http://localhost:5001/TU_PROYECTO/us-central1"
  // En producción:       "https://us-central1-TU_PROYECTO.cloudfunctions.net"
  //   o si usas Firebase Hosting rewrites: ""  (relativo)
  functionsUrl: "https://us-central1-TU_PROYECTO_FIREBASE.cloudfunctions.net",

  // "sandbox" para pruebas, "production" para cobros reales
  env: "sandbox",
};

// ─────────────────────────────────────────────────────────────────────────────
// crearPagoMP(reservaData)
//
// Llama a la Cloud Function crearPago, obtiene el link de MP
// y redirige al cliente. Si falla, lanza un error.
//
// Uso:
//   await crearPagoMP({
//     folio, nombre, tel, ruta, fecha, horario,
//     unidadId, unidadNombre, placa,
//     conductorId, conductorNombre, conductorClabe, conductorBanco,
//     lugar, personas, metodoPago
//   });
// ─────────────────────────────────────────────────────────────────────────────
async function crearPagoMP(reservaData) {
  const url = `${SUBE_CONFIG.functionsUrl}/crearPago`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reservaData),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Error ${resp.status} al crear el pago`);
  }

  const { initPoint, sandboxInitPoint } = await resp.json();

  // Redirigir al checkout de Mercado Pago
  const link = SUBE_CONFIG.env === "production" ? initPoint : sandboxInitPoint;
  window.location.href = link;
}

// ─────────────────────────────────────────────────────────────────────────────
// consultarEstadoReserva(folio)
//
// Úsala en la página de retorno (/pago-exitoso?folio=SB-XXXXX)
// para obtener el estado real de la reserva desde Firestore.
// ─────────────────────────────────────────────────────────────────────────────
async function consultarEstadoReserva(folio) {
  const url = `${SUBE_CONFIG.functionsUrl}/estadoReserva?folio=${encodeURIComponent(folio)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error ${resp.status}`);
  return await resp.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// generarFolio()
// Genera un folio único tipo SB-A1B2C3
// ─────────────────────────────────────────────────────────────────────────────
function generarFolio() {
  return "SB-" + Date.now().toString(36).toUpperCase().slice(-6);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejemplo de integración en el paso 6 de Sube (botón "Pagar $100")
//
// Reemplaza la función simularPago() en tu app con esto:
// ─────────────────────────────────────────────────────────────────────────────
async function pagarConMP(bState) {
  const folio = generarFolio();
  const cond = bState.unidad
    ? /* busca el conductor en tu db local */ null
    : null;

  const reservaData = {
    folio,
    nombre:          bState.nombre,
    tel:             bState.tel,
    email:           bState.email || "",   // opcional
    ruta:            bState.ruta,
    fecha:           bState.fecha,
    horario:         bState.horario,
    unidadId:        bState.unidad.id,
    unidadNombre:    bState.unidad.nombre,
    placa:           bState.unidad.placa,
    conductorId:     cond?.id     || "",
    conductorNombre: cond ? `${cond.nombre} ${cond.apellido}` : "",
    conductorClabe:  cond?.clabe  || "",
    conductorBanco:  cond?.banco  || "",
    lugar:           bState.lugar,
    personas:        bState.personas,
    metodoPago:      bState.metodoPago,
  };

  // Mostrar spinner / deshabilitar botón antes de redirigir
  const btn = document.querySelector("#btn-pagar");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Redirigiendo a Mercado Pago…";
  }

  try {
    await crearPagoMP(reservaData);
    // Si llegamos aquí fue redirigido — este código no se ejecuta
  } catch (err) {
    console.error("Error MP:", err);
    alert("No pudimos conectar con Mercado Pago. Intenta de nuevo.");
    if (btn) { btn.disabled = false; btn.textContent = "Pagar $100 con Mercado Pago"; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Página de retorno — pago-exitoso.html
// Llama a esto cuando MP regresa al cliente tras pagar.
// ─────────────────────────────────────────────────────────────────────────────
async function manejarRetornoPago() {
  const params = new URLSearchParams(window.location.search);
  const folio        = params.get("folio");
  const mpStatus     = params.get("status");           // approved | pending | failure
  const mpPaymentId  = params.get("payment_id");

  if (!folio) return;

  if (mpStatus === "approved") {
    // Verificar con el backend (no confiar solo en el parámetro de URL)
    try {
      const reserva = await consultarEstadoReserva(folio);
      if (reserva.estado === "confirmada") {
        mostrarTicketExitoso(reserva);
      } else {
        // El webhook aún no llegó, esperar 3 seg y reintentar
        setTimeout(async () => {
          const r2 = await consultarEstadoReserva(folio);
          mostrarTicketExitoso(r2);
        }, 3000);
      }
    } catch (e) {
      console.error(e);
    }
  } else if (mpStatus === "pending") {
    mostrarPagoPendiente(folio);
  } else {
    mostrarPagoFallido(folio);
  }
}

function mostrarTicketExitoso(reserva) {
  // Aquí renderizas el folio con los datos de reserva
  // (misma lógica del ticket actual en Sube)
  console.log("Reserva confirmada:", reserva);
}

function mostrarPagoPendiente(folio) {
  console.log("Pago pendiente para folio:", folio);
}

function mostrarPagoFallido(folio) {
  console.log("Pago fallido para folio:", folio);
}
