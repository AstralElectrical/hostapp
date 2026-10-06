// Etiquetas en español para el panel: [texto, color del chip].
export const OUTCOME: Record<string, [string, string]> = {
  automated: ["Resuelta por Casia", "ok"], transferred: ["Transferida", "warn"], message: ["Recado", "warn"], abandoned: ["Colgó", "bad"],
};
export const ORDER_STATUS: Record<string, [string, string]> = {
  awaiting_payment: ["Esperando pago", "warn"], new: ["Nuevo", "ok"], preparing: ["Preparando", ""], ready: ["Listo", "ok"], completed: ["Entregado", ""], cancelled: ["Cancelado", "bad"],
};
export const RESV_STATUS: Record<string, [string, string]> = {
  confirmed: ["Confirmada", "ok"], awaiting_deposit: ["Esperando depósito", "warn"], needs_approval: ["Por aprobar", "warn"], seated: ["Sentados", ""], completed: ["Terminó", ""], no_show: ["No llegó", "bad"], cancelled: ["Cancelada", "bad"],
};
