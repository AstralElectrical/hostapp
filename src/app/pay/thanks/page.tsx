export default async function Thanks({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  return (
    <main className="main" style={{ maxWidth: 420, margin: "12vh auto", textAlign: "center" }}>
      <div className="card">
        {cancelled ? (
          <><h1>Pago cancelado</h1><p>No se hizo ningún cargo. Puedes volver a abrir el link del mensaje cuando quieras.</p></>
        ) : (
          <><h1>¡Gracias! / Thank you!</h1><p>Recibimos tu pago. Tu pedido o reserva ya está confirmado.</p><p className="muted">Payment received. You&apos;re all set.</p></>
        )}
      </div>
    </main>
  );
}
