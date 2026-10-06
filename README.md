# HostApp

Recepcionista de voz con IA para restaurantes. La voz se llama **Casia**: contesta el teléfono 24/7 en español e inglés, toma **pedidos** y **reservas** completas, responde menú e info del local, y **nunca deja a nadie colgado** (si no se puede transferir, toma el recado y le manda SMS al dueño).

Es un producto aparte de Astral. Reusa el mismo diseño de voz que **Ana** en Astral Field: Vapi pone el teléfono, el oído y la voz; el cerebro vive aquí (`/api/voice/<restaurante>/<secreto>/chat/completions`) y usa Claude con herramientas reales.

## Qué hace

| Área | Qué tiene |
|---|---|
| Llamadas | Casia bilingüe, honesta si le preguntan si es IA, saludo con el mismo nombre de la voz |
| Pedidos | Precios siempre desde el menú + impuesto, para recoger o a domicilio, **link de pago de Stripe por SMS** (jamás tarjeta por teléfono) o pago al recoger, pantalla de cocina con sonido |
| Reservas | Libro propio con capacidad real, crear / cambiar / cancelar, grupos grandes con aprobación del dueño, depósito con link de Stripe, lista de espera con aviso automático, "voy tarde" |
| Transferencias | Siempre guarda el recado y avisa por SMS primero; en horario transfiere en vivo (Vapi Live Call Control) |
| Panel del dueño | Insights 7/30 días con comparación y alertas, ventas por teléfono, llamadas con resumen y transcripción, CRM de clientes, recados, menú inteligente (sube el PDF), horario único, ajustes, "Probar a Casia" en modo práctica |
| Reportes | CSV de llamadas, pedidos, reservas y recados |

## Correr en tu compu

```bash
npm install
cp .env.example .env.local      # llena DATABASE_URL como mínimo
npm run db:migrate              # crea las tablas
npm run db:seed                 # restaurante demo: demo@hostapp.local / demo1234
npm run dev                     # http://localhost:3000
npm test                        # pruebas (usan una base Postgres en memoria)
```

## Salir en vivo (pasos, en orden)

1. **Supabase**: crea el proyecto y pon `DATABASE_URL` (pooler, puerto 6543). `npm run db:migrate`.
2. **Vercel**: importa este repo y copia las variables de `.env.example`.
3. **Restaurante**: entra a `/signup` con el código de invitación, carga el menú, horario, info y transferencias. El panel no deja activar a Casia hasta completar la lista.
4. **Vapi**: `npm run vapi:setup -- <slug>` muestra el assistant que se va a crear (misma voz que Ana, transcriptor multilingüe). Con `--apply` lo crea. Luego asígnalo al número del restaurante en Vapi.
5. **Stripe Connect**: conecta la cuenta del restaurante, pega su `acct_…` en Ajustes, y crea el webhook `checkout.session.completed` (cuentas conectadas) hacia `/api/stripe/webhook`.
6. **Twilio**: llena las variables y quita `SMS_DRY_RUN` cuando quieras que salgan mensajes reales.

## Estructura

- `src/lib/casia/` — el cerebro: prompt, herramientas y bucle con Claude
- `src/lib/services/` — reservas, pedidos, recados, llamadas, métricas, lectura de menú
- `src/app/api/voice/` — conexión con Vapi (turnos y fin de llamada)
- `src/app/r/[slug]/` — panel del dueño
- `src/db/schema.ts` y `drizzle/` — base de datos
- `test/` — pruebas de punta a punta con Postgres en memoria
