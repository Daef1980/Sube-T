const { MercadoPagoConfig, Payment } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// Almacen simple en memoria (en producción usar Firestore/DB)
// Las reservas confirmadas se guardan aquí
global.reservasConfirmadas = global.reservasConfirmadas || {};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // MP requiere respuesta 200 inmediata
  res.status(200).send("OK");

  try {
    const { type, data } = req.body || {};
    if (type !== "payment" || !data?.id) return;

    const payment = new Payment(client);
    const pagoInfo = await payment.get({ id: data.id });

    const folio = pagoInfo.external_reference;
    const status = pagoInfo.status;

    console.log(`Webhook: folio=${folio} status=${status}`);

    if (status === "approved" && folio) {
      global.reservasConfirmadas[folio] = {
        estado: "confirmada",
        mpPaymentId: data.id,
        pagadoEn: new Date().toISOString(),
      };
      console.log(`✅ Reserva ${folio} CONFIRMADA`);
    }

  } catch (error) {
    console.error("Error webhook:", error);
  }
};
