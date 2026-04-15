// sem o dotenv — Railway injeta as variáveis direto
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const ZAPI_BASE = `https://api.z-api.io/instances/3F19952FA6E6A2C35AEF6E59E5E6857E/token/671FB61810A695471479EF1A`;

const db = {
  barbers: [
    { id: "b1", name: "Carlos Silva", specialty: "Cortes Clássicos" },
    { id: "b2", name: "Rafael Mendes", specialty: "Barba & Design" },
    { id: "b3", name: "Lucas Oliveira", specialty: "Degradê & Estilo" },
  ],
  services: [
    { id: "s1", name: "Corte de Cabelo", price: 35, duration: 30 },
    { id: "s2", name: "Barba", price: 25, duration: 20 },
    { id: "s3", name: "Cabelo + Barba", price: 55, duration: 45 },
    { id: "s4", name: "Sobrancelha", price: 15, duration: 15 },
    { id: "s5", name: "Limpeza de Pele", price: 60, duration: 60 },
  ],
  appointments: [],
  sessions: {},
};

const TIME_SLOTS = [
  "09:00","09:30","10:00","10:30","11:00","11:30",
  "12:00","12:30","13:00","13:30","14:00","14:30",
  "15:00","15:30","16:00","16:30","17:00","17:30",
  "18:00","18:30","19:00"
];

const todayISO = () => new Date().toISOString().split("T")[0];

const fmtDate = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};

const getNextDays = (n = 7) => {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().split("T")[0];
  });
};

const getAvailableSlots = (barberId, date) => {
  const booked = db.appointments
    .filter(a => a.barberId === barberId && a.date === date)
    .map(a => a.time);
  return TIME_SLOTS.filter(t => !booked.includes(t));
};

const getSession = (phone) => {
  if (!db.sessions[phone]) {
    db.sessions[phone] = { step: "idle", data: {} };
  }
  return db.sessions[phone];
};

const resetSession = (phone) => {
  db.sessions[phone] = { step: "idle", data: {} };
};

async function sendText(phone, text) {
  try {
    await axios.post(`${ZAPI_BASE}/send-text`, { phone, message: text });
  } catch (e) {
    console.error("Erro ao enviar texto:", e.response?.data || e.message);
  }
}

async function sendList(phone, title, buttonLabel, sections) {
  try {
    await axios.post(`${ZAPI_BASE}/send-list`, {
      phone,
      listMessage: { title, buttonLabel, sections },
    });
  } catch (e) {
    console.error("Erro ao enviar lista:", e.response?.data || e.message);
    let fallback = `*${title}*\n\n`;
    sections.forEach(section => {
      if (section.title) fallback += `*${section.title}*\n`;
      section.rows.forEach((row, i) => {
        fallback += `${i + 1}. ${row.title}${row.description ? ` — ${row.description}` : ""}\n`;
      });
    });
    fallback += "\n_Responda com o número da opção desejada._";
    await sendText(phone, fallback);
  }
}

async function sendButtons(phone, text, buttons) {
  try {
    await axios.post(`${ZAPI_BASE}/send-button-list`, {
      phone,
      message: text,
      buttonList: {
        buttons: buttons.map((b, i) => ({
          buttonId: b.id || String(i + 1),
          buttonText: { displayText: b.label },
          type: 1,
        })),
      },
    });
  } catch (e) {
    console.error("Erro ao enviar botões:", e.response?.data || e.message);
    await sendText(phone, text);
  }
}

async function handleMessage(phone, messageText, clientName) {
  const session = getSession(phone);
  const text = (messageText || "").trim().toLowerCase();

  if (session.step === "idle") {
    const greetings = ["oi","olá","ola","oii","boa tarde","bom dia","boa noite","hello","hi","hey","quero","agendar"];
    const isGreeting = greetings.some(g => text.includes(g)) || text.length < 15;
    if (!isGreeting) {
      await sendText(phone, "Olá! 👋 Para agendar um horário, é só mandar um *oi*!");
      return;
    }
    session.data.clientName = clientName || phone;
    session.step = "awaiting_service";
    await sendText(phone, `Olá, *${session.data.clientName}*! 😊\nBem-vindo à *BarberPro*! Vou te ajudar a agendar.`);
    await sendList(phone, "Qual serviço você deseja?", "Ver serviços", [{
      title: "Nossos Serviços",
      rows: db.services.map(s => ({
        rowId: s.id,
        title: s.name,
        description: `R$ ${s.price} — ${s.duration} minutos`,
      })),
    }]);
    return;
  }

  if (session.step === "awaiting_service") {
    let service = db.services.find(s => s.id === messageText?.trim());
    if (!service) {
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= db.services.length) service = db.services[num - 1];
    }
    if (!service) service = db.services.find(s => s.name.toLowerCase().includes(text));
    if (!service) {
      await sendText(phone, "Por favor, selecione uma das opções da lista.");
      return;
    }
    session.data.serviceId = service.id;
    session.data.serviceName = service.name;
    session.step = "awaiting_barber";
    await sendList(phone, `Ótimo! *${service.name}* selecionado.\n\nAgora escolha o barbeiro:`, "Ver barbeiros", [{
      title: "Nossos Barbeiros",
      rows: db.barbers.map(b => ({
        rowId: b.id,
        title: b.name,
        description: b.specialty,
      })),
    }]);
    return;
  }

  if (session.step === "awaiting_barber") {
    let barber = db.barbers.find(b => b.id === messageText?.trim());
    if (!barber) {
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= db.barbers.length) barber = db.barbers[num - 1];
    }
    if (!barber) barber = db.barbers.find(b => b.name.toLowerCase().includes(text));
    if (!barber) {
      await sendText(phone, "Por favor, selecione um dos barbeiros da lista.");
      return;
    }
    session.data.barberId = barber.id;
    session.data.barberName = barber.name;
    session.step = "awaiting_date";
    const days = getNextDays(7);
    await sendList(phone, `*${barber.name}* selecionado! Qual data prefere?`, "Ver datas", [{
      title: "Próximos 7 dias",
      rows: days.map((iso, i) => ({
        rowId: iso,
        title: i === 0 ? `Hoje — ${fmtDate(iso)}` : fmtDate(iso),
        description: "",
      })),
    }]);
    return;
  }

  if (session.step === "awaiting_date") {
    let dateISO = null;
    const days = getNextDays(7);
    if (/^\d{4}-\d{2}-\d{2}$/.test(messageText?.trim())) {
      dateISO = messageText.trim();
    } else {
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= days.length) dateISO = days[num - 1];
      else if (text.includes("hoje")) dateISO = todayISO();
      else if (text.includes("amanhã") || text.includes("amanha")) {
        const d = new Date(); d.setDate(d.getDate() + 1);
        dateISO = d.toISOString().split("T")[0];
      }
    }
    if (!dateISO || !days.includes(dateISO)) {
      await sendText(phone, "Por favor, selecione uma das datas disponíveis.");
      return;
    }
    session.data.date = dateISO;
    const available = getAvailableSlots(session.data.barberId, dateISO);
    if (available.length === 0) {
      await sendText(phone, `😔 Não há horários disponíveis com *${session.data.barberName}* em *${fmtDate(dateISO)}*. Escolha outra data.`);
      session.step = "awaiting_date";
      await sendList(phone, "Escolha outra data:", "Ver datas", [{
        title: "Próximos 7 dias",
        rows: days.map((iso, i) => ({ rowId: iso, title: i === 0 ? `Hoje — ${fmtDate(iso)}` : fmtDate(iso), description: "" })),
      }]);
      return;
    }
    session.step = "awaiting_time";
    await sendList(phone, `Horários disponíveis em *${fmtDate(dateISO)}* com *${session.data.barberName}*:`, "Ver horários", [{
      title: "Horários livres",
      rows: available.slice(0, 15).map(t => ({ rowId: t, title: `⏰ ${t}`, description: "" })),
    }]);
    return;
  }

  if (session.step === "awaiting_time") {
    const available = getAvailableSlots(session.data.barberId, session.data.date);
    let time = TIME_SLOTS.includes(messageText?.trim()) ? messageText.trim() : null;
    if (!time) {
      const cleaned = text.replace(/h/g, ":").replace(/\s/g, "");
      time = TIME_SLOTS.find(t => t === cleaned || t.replace(":", "") === cleaned.replace(":", "")) || null;
    }
    if (!time || !available.includes(time)) {
      await sendText(phone, "Por favor, selecione um dos horários disponíveis.");
      return;
    }
    session.data.time = time;
    session.step = "awaiting_confirm";
    const svc = db.services.find(s => s.id === session.data.serviceId);
    const confirmText =
      `✅ *Confirme seu agendamento:*\n\n` +
      `📅 *Data:* ${fmtDate(session.data.date)}\n` +
      `⏰ *Horário:* ${time}\n` +
      `💈 *Serviço:* ${session.data.serviceName} — R$ ${svc?.price}\n` +
      `👨‍💈 *Barbeiro:* ${session.data.barberName}\n\n` +
      `Confirmar agendamento?`;
    await sendButtons(phone, confirmText, [
      { id: "confirm_yes", label: "✅ Sim, confirmar!" },
      { id: "confirm_no", label: "❌ Não, cancelar" },
    ]);
    return;
  }

  if (session.step === "awaiting_confirm") {
    const confirmed = messageText === "confirm_yes" || text.includes("sim") || text.includes("confirmar") || text === "1";
    const cancelled = messageText === "confirm_no" || text.includes("não") || text.includes("nao") || text.includes("cancelar") || text === "2";
    if (confirmed) {
      const appointment = {
        id: Date.now().toString(),
        clientName: session.data.clientName,
        clientPhone: phone,
        barberId: session.data.barberId,
        serviceId: session.data.serviceId,
        date: session.data.date,
        time: session.data.time,
      };
      db.appointments.push(appointment);
      resetSession(phone);
      await sendText(phone,
        `🎉 *Agendamento confirmado!*\n\n` +
        `📅 ${fmtDate(appointment.date)} às ${appointment.time}\n` +
        `👨‍💈 Barbeiro: ${session.data.barberName}\n\n` +
        `Te esperamos, *${appointment.clientName}*! ✂️\n\n` +
        `_Se precisar cancelar, é só chamar aqui._`
      );
      return;
    }
    if (cancelled) {
      resetSession(phone);
      await sendText(phone, "Sem problemas! Se quiser agendar outro horário, é só chamar. Até logo! 👋");
      return;
    }
    await sendText(phone, "Por favor, confirme respondendo *Sim* ou *Não*.");
    return;
  }
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (!body || body.fromMe === true) return;
    const phone = body.phone || body.chatId?.replace("@c.us", "") || body.from;
    const clientName = body.senderName || body.pushName || phone;
    let messageText = null;
    if (body.text?.message) messageText = body.text.message;
    else if (body.listResponseMessage?.singleSelectReply?.selectedRowId) messageText = body.listResponseMessage.singleSelectReply.selectedRowId;
    else if (body.buttonsResponseMessage?.selectedButtonId) messageText = body.buttonsResponseMessage.selectedButtonId;
    else if (typeof body.message === "string") messageText = body.message;
    if (!phone || !messageText) return;
    console.log(`📱 ${phone} (${clientName}): ${messageText}`);
    await handleMessage(phone, messageText, clientName);
  } catch (err) {
    console.error("Erro no webhook:", err);
  }
});

app.get("/api/appointments", (req, res) => {
  const { date, barberId } = req.query;
  let results = db.appointments;
  if (date) results = results.filter(a => a.date === date);
  if (barberId) results = results.filter(a => a.barberId === barberId);
  res.json(results);
});

app.get("/api/barbers", (req, res) => res.json(db.barbers));
app.get("/api/services", (req, res) => res.json(db.services));

app.get("/api/slots", (req, res) => {
  const { barberId, date } = req.query;
  if (!barberId || !date) return res.status(400).json({ error: "barberId e date são obrigatórios" });
  res.json(getAvailableSlots(barberId, date));
});

app.delete("/api/appointments/:id", (req, res) => {
  const idx = db.appointments.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Não encontrado" });
  db.appointments.splice(idx, 1);
  res.json({ ok: true });
});

app.get("/", (req, res) => res.json({ status: "ok", appointments: db.appointments.length }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BarberPro Bot rodando na porta ${PORT}`);
  console.log(`📡 Webhook: http://localhost:${PORT}/webhook`);
});
