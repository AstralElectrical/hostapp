"use client";
import { useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

export default function TestChat({ slug, greeting }: { slug: string; greeting: string }) {
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", content: greeting }]);
  const [tools, setTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function send(form: FormData) {
    const text = String(form.get("q") ?? "").trim();
    if (!text) return;
    const next = [...turns, { role: "user" as const, content: text }];
    setTurns(next); setBusy(true);
    const res = await fetch(`/api/r/${slug}/test-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turns: next }) });
    const j = await res.json().catch(() => ({ text: "(error)", tools: [] }));
    setBusy(false);
    setTurns([...next, { role: "assistant", content: j.text }]);
    setTools(j.tools ?? []);
  }
  return (
    <div className="card stack">
      <div className="chat">{turns.map((t, i) => <div key={i} className={`bubble ${t.role}`}>{t.content}</div>)}{busy && <div className="bubble assistant muted">…</div>}</div>
      {tools.length > 0 && <div className="small muted">Usó: {tools.join(", ")}</div>}
      <form action={send} className="row"><input name="q" placeholder="Hola, ¿tienen mesa para 4 el viernes a las 7?" style={{ flex: 1 }} autoComplete="off" /><button className="primary" disabled={busy}>Enviar</button>
        <button type="button" onClick={() => { setTurns([{ role: "assistant", content: greeting }]); setTools([]); }}>Reiniciar</button></form>
    </div>
  );
}
