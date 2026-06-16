# Sube — Integración Mercado Pago

## Estructura de archivos

```
sube/
├── functions/
│   ├── index.js          ← Cloud Functions (backend)
│   └── package.json
├── public/
│   └── sube-mercadopago.js  ← Módulo frontend
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
└── README.md
```

---

## Paso 1 — Instalar Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

---

## Paso 2 — Inicializar el proyecto Firebase

```bash
cd sube
firebase init
```

Selecciona:
- ✅ Functions
- ✅ Firestore
- ✅ Hosting (opcional, si quieres alojar la app ahí)

Usa el proyecto que ya tienes en Firebase Console.

---

## Paso 3 — Instalar dependencias de Functions

```bash
cd functions
npm install
cd ..
```

---

## Paso 4 — Configurar las credenciales de Mercado Pago

### 4a. Obtén tus credenciales en:
https://www.mercadopago.com.mx/developers/panel/credentials

Necesitas el **Access Token** (NO la Public Key — esa es solo para el frontend).

Hay dos entornos:
- **Sandbox** (pruebas): `TEST-xxxx...`
- **Producción** (real): `APP_USR-xxxx...`

### 4b. Guárdalas en Firebase (nunca en el código):

```bash
# Sandbox (para pruebas):
firebase functions:config:set mp.access_token="TEST-xxxxxxxxxxxx"

# Cuando estés listo para producción, cambia al token real:
firebase functions:config:set mp.access_token="APP_USR-xxxxxxxxxxxx"
```

---

## Paso 5 — Actualizar las URLs en el código

### En `functions/index.js`, busca y reemplaza:
```
TU_DOMINIO.com        → tu dominio real (ej. sube.app o tudominio.vercel.app)
TU_REGION             → us-central1 (o la región de tu proyecto Firebase)
TU_PROYECTO           → el ID de tu proyecto Firebase
```

### En `public/sube-mercadopago.js`, busca y reemplaza:
```
TU_PROYECTO_FIREBASE  → el ID de tu proyecto Firebase
```

---

## Paso 6 — Probar en Sandbox

```bash
# Levantar emulador local
firebase emulators:start --only functions,firestore

# En otra terminal, prueba la función:
curl -X POST http://localhost:5001/TU_PROYECTO/us-central1/crearPago \
  -H "Content-Type: application/json" \
  -d '{
    "folio": "SB-TEST01",
    "nombre": "María López",
    "tel": "8661234567",
    "ruta": "MCL",
    "fecha": "2025-07-01",
    "horario": "5AM – 7AM",
    "unidadId": "u1",
    "unidadNombre": "VW Tiguan",
    "placa": "ABC-123",
    "lugar": 2,
    "personas": 1,
    "metodoPago": "efectivo"
  }'
```

Deberías recibir un `sandboxInitPoint` — ábrelo en el navegador y paga con tarjeta de prueba:
- Número: `4009 1753 3280 6176`
- Vencimiento: cualquier fecha futura
- CVV: cualquier 3 dígitos
- Nombre: cualquiera

---

## Paso 7 — Deploy a producción

```bash
firebase deploy --only functions,firestore
```

Anota las URLs que imprime Firebase al terminar. Son del tipo:
```
https://us-central1-TU_PROYECTO.cloudfunctions.net/crearPago
https://us-central1-TU_PROYECTO.cloudfunctions.net/webhookPago
https://us-central1-TU_PROYECTO.cloudfunctions.net/estadoReserva
```

---

## Paso 8 — Registrar el webhook en Mercado Pago

En https://www.mercadopago.com.mx/developers/panel/notifications/webhooks

- URL: `https://us-central1-TU_PROYECTO.cloudfunctions.net/webhookPago`
- Eventos: ✅ Payments

---

## Paso 9 — Integrar en la app Sube

En el archivo principal de Sube, reemplaza `simularPago()` por:

```javascript
// Incluir el script
<script src="sube-mercadopago.js"></script>

// Reemplazar el botón de confirmación:
async function pagarDeposito() {
  const cond = db.conductores.find(c => c.id === bState.unidad.conductor);
  await pagarConMP({
    ...bState,
    email: "",  // puedes agregar un campo email al formulario
    unidad: bState.unidad,
    conductor: cond,
  });
}
```

Y en el HTML del botón:
```html
<button id="btn-pagar" onclick="pagarDeposito()">
  Pagar $100 con Mercado Pago
</button>
```

---

## Colecciones Firestore que se crean automáticamente

| Colección   | Descripción                          |
|-------------|--------------------------------------|
| `reservas`  | Una doc por reserva, key = folio     |
| `pagos`     | Registro de cada pago aprobado       |
| `unidades`  | Vehículos (gestionar desde la app)   |
| `conductores` | Conductores (gestionar desde la app)|

---

## Costos estimados

| Concepto                    | Costo                         |
|-----------------------------|-------------------------------|
| Firebase Functions          | Gratis hasta 2M invocaciones  |
| Firestore                   | Gratis hasta 50K lecturas/día |
| Mercado Pago comisión        | ~3.6% + IVA por transacción   |
| Por cada depósito de $100   | ~$4.18 de comisión            |

---

## Soporte

Documentación Mercado Pago MX:
https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/landing
