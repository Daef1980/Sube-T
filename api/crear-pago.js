const { MercadoPagoConfig, Preference } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const {
      folio, nombre, tel, ruta, fecha, horario,
      unidadNombre, placa, conductorNombre,
      lugar, personas, metodoPago,
    } = req.body;

    if (!folio || !nombre || !ruta || !fecha || !horario) {
      return res.status(400).json({ error: "Faltan datos de la reserva" });
    }

    const rutaNombre = ruta === "MCL" ? "Monclova → Monterrey" : "Monterrey → Monclova";
    const BASE_URL = "https://sube-t.vercel.app";

    const preference = new Preference(client);
    const response = await preference.create({
      body: {
        external_reference: folio,
        items: [{
          id: folio,
          title: `Sube T · ${rutaNombre}`,
          description: `${fecha} · ${horario} · Lugar #${lugar} · ${nombre}`,
          quantity: 1,
          unit_price: 100,
          currency_id: "MXN",
        }],
        payer: { name: nombre, phone: { number: tel } },
        back_urls: {
          success: `${BASE_URL}?pago=exitoso&folio=${folio}`,
          failure: `${BASE_URL}?pago=fallido&folio=${folio}`,
          pending: `${BASE_URL}?pago=pendiente&folio=${folio}`,
        },
        auto_return: "approved",
        statement_descriptor: "SUBE TRANSPORTES",
        payment_methods: { installments: 1 },
      },
    });

    return res.status(200).json({
      preferenceId: response.id,
      initPoint: response.init_point,
      sandboxInitPoint: response.sandbox_init_point,
    });

  } catch (error) {
    console.error("Error crear-pago:", error);
    return res.status(500).json({ error: error.message });
  }
};
