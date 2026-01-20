import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.static(path.join(__dirname, "public")));

const MAX_TOTAL_MB = Number(process.env.MAX_TOTAL_UPLOAD_MB || 15);
const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_TOTAL_BYTES },
  fileFilter: (req, file, cb) => {
    const ok = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
      "application/zip",
      "application/x-zip-compressed"
    ].includes(file.mimetype);

    if (!ok) return cb(new Error("Tipo di file non consentito."));
    cb(null, true);
  }
});

function makeTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP non configurato: verifica SMTP_HOST/SMTP_USER/SMTP_PASS.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

function safeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function parseJsonField(req, fieldName) {
  try {
    return JSON.parse(req.body[fieldName] || "null");
  } catch {
    return null;
  }
}

function required(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
}

function formatEmailText(data) {
  const lines = [];
  lines.push("== Nuova richiesta: Questionario preliminare brevetto ==");
  lines.push("");
  lines.push(`Data/ora (server): ${new Date().toISOString()}`);
  lines.push("");

  lines.push("== 1) Privacy e consensi ==");
  lines.push(`- Presa visione privacy: ${data.privacyViewed ? "SI" : "NO"}`);
  lines.push(`- Consenso contatto: ${data.contactConsent ? "SI" : "NO"}`);
  lines.push("");

  lines.push("== 2) Richiedente (titolare) ==");
  lines.push(`- Tipo richiedente: ${data.applicantType}`);
  if (data.applicantType === "Azienda/Ente") {
    lines.push(`- Denominazione: ${safeStr(data.company?.name)}`);
    lines.push(`- Forma giuridica: ${safeStr(data.company?.legalForm)}`);
    lines.push(`- Sede legale: ${safeStr(data.company?.hq)}`);
    lines.push(`- Paese: ${safeStr(data.company?.country)}`);
    lines.push(`- P.IVA: ${safeStr(data.company?.vat)}`);
    lines.push(`- C.F.: ${safeStr(data.company?.taxCode)}`);
    lines.push(`- Email: ${safeStr(data.company?.email)}`);
    lines.push(`- PEC: ${safeStr(data.company?.pec)}`);
    lines.push(`- Telefono: ${safeStr(data.company?.phone)}`);
    lines.push(`- Legale rappresentante: ${safeStr(data.company?.repName)}`);
    lines.push(`- C.F. legale rappresentante: ${safeStr(data.company?.repTaxCode)}`);
  } else if (data.applicantType === "Persona fisica") {
    lines.push(`- Nome e cognome: ${safeStr(data.person?.fullName)}`);
    lines.push(`- C.F.: ${safeStr(data.person?.taxCode)}`);
    lines.push(`- Nascita: ${safeStr(data.person?.birthPlaceDate)}`);
    lines.push(`- Residenza: ${safeStr(data.person?.residence)}`);
    lines.push(`- Paese: ${safeStr(data.person?.country)}`);
    lines.push(`- Email: ${safeStr(data.person?.email)}`);
    lines.push(`- PEC: ${safeStr(data.person?.pec)}`);
    lines.push(`- Telefono: ${safeStr(data.person?.phone)}`);
  } else {
    lines.push(`- Contitolari: ${safeStr(data.coOwnersText)}`);
  }
  lines.push("");

  lines.push("== 3) Inventore/i ==");
  (data.inventors || []).forEach((inv, idx) => {
    lines.push(`-- Inventore ${idx + 1} --`);
    lines.push(`  Nome e cognome: ${safeStr(inv.fullName)}`);
    lines.push(`  C.F.: ${safeStr(inv.taxCode)}`);
    lines.push(`  Nascita: ${safeStr(inv.birthPlaceDate)}`);
    lines.push(`  Residenza: ${safeStr(inv.residence)}`);
    lines.push(`  Paese: ${safeStr(inv.country)}`);
    lines.push(`  Email: ${safeStr(inv.email)}`);
    lines.push(`  PEC: ${safeStr(inv.pec)}`);
    lines.push(`  Telefono: ${safeStr(inv.phone)}`);
  });
  lines.push("");

  lines.push("== 4) Titolo e campo tecnico ==");
  lines.push(`- Titolo: ${safeStr(data.inventionTitle)}`);
  lines.push(`- Campo tecnico: ${safeStr(data.technicalField)}`);
  lines.push("");

  lines.push("== 5) Riassunto (elevator pitch) ==");
  lines.push(`- Descrizione: ${safeStr(data.pitch)}`);
  lines.push(`- Ambito applicativo: ${safeStr(data.applicationArea)}`);
  lines.push(`- Beneficio principale: ${safeStr(data.mainBenefit)}`);
  lines.push("");

  lines.push("== 6) Stato dell’arte ==");
  lines.push(`- Descrizione: ${safeStr(data.priorArtDescription)}`);
  lines.push(`- Link: ${(data.priorArtLinks || []).filter(Boolean).join(", ")}`);
  lines.push(`- Brevetti/pubblicazioni noti: ${safeStr(data.priorArtPatents)}`);
  lines.push("");

  lines.push("== 7) Problema tecnico ==");
  lines.push(`- Problema: ${safeStr(data.technicalProblem)}`);
  lines.push(`- Vincoli/requisiti: ${safeStr(data.constraints)}`);
  lines.push(`- Metriche/criteri: ${safeStr(data.metrics)}`);
  lines.push("");

  lines.push("== 8) Soluzione e vantaggi ==");
  lines.push(`- Soluzione: ${safeStr(data.solution)}`);
  lines.push(`- Vantaggi: ${safeStr(data.advantages)}`);
  lines.push(`- Svantaggi/compromessi: ${safeStr(data.tradeoffs)}`);
  lines.push("");

  lines.push("== 9) Caratteristiche innovative ==");
  lines.push(`- Caratteristiche nuove: ${safeStr(data.innovativeFeatures)}`);
  lines.push(`- Indispensabili vs opzionali: ${safeStr(data.mustHaveVsOptional)}`);
  lines.push(`- Varianti previste: ${safeStr(data.variants)}`);
  lines.push("");

  lines.push("== 10) Descrizione tecnica ==");
  lines.push(`- Tipologia: ${(data.inventionTypes || []).join(", ")}`);
  lines.push(`- Architettura/struttura: ${safeStr(data.architecture)}`);
  lines.push(`- Funzionamento: ${safeStr(data.workflow)}`);
  lines.push(`- Materiali/parametri: ${safeStr(data.parameters)}`);
  lines.push(`- Controllo/Software: ${safeStr(data.controlSoftware)}`);
  lines.push(`- Varianti realizzative: ${safeStr(data.embodiments)}`);
  lines.push(`- Limiti/edge cases: ${safeStr(data.edgeCases)}`);
  lines.push("");

  lines.push("== 11) Disegni/figure ==");
  lines.push(`- Disponibilità: ${safeStr(data.drawingsAvailable)}`);
  lines.push(`- Descrizione figure: ${safeStr(data.figureDescriptions)}`);
  lines.push("");

  lines.push("== 12) Prototipo/test ==");
  lines.push(`- Prototipo: ${safeStr(data.prototypeStatus)}`);
  lines.push(`- Test/simulazioni: ${safeStr(data.testsStatus)}`);
  lines.push(`- Risultati: ${safeStr(data.testResults)}`);
  lines.push("");

  lines.push("== 13) Divulgazioni e confidenzialità ==");
  lines.push(`- Già divulgata: ${safeStr(data.disclosed)}`);
  lines.push(`- Come: ${safeStr(data.disclosureHow)}`);
  lines.push(`- Quando/dove: ${safeStr(data.disclosureWhenWhere)}`);
  lines.push(`- A chi: ${safeStr(data.disclosureToWhom)}`);
  lines.push(`- Divulgazione futura: ${safeStr(data.futureDisclosure)}`);
  lines.push(`- Quando/contesto: ${safeStr(data.futureDisclosureDetails)}`);
  lines.push(`- NDA con terzi: ${safeStr(data.ndaSigned)}`);
  lines.push("");

  lines.push("== 14) Titolarità e rapporti ==");
  lines.push(`- Inventore coincide con richiedente: ${safeStr(data.inventorEqualsApplicant)}`);
  lines.push(`- Sviluppata nell’ambito di: ${(data.developmentContext || []).join(", ")}`);
  lines.push(`- Collaborazione con Università/Ente di ricerca: ${safeStr(data.universityCollab)}`);
  lines.push(`- Dettagli collaborazione università: ${safeStr(data.universityCollabDetails)}`);
  lines.push(`- Contratti/accordi rilevanti: ${safeStr(data.relevantAgreements)}`);
  lines.push(`- Dettagli accordi: ${safeStr(data.relevantAgreementsDetails)}`);
  lines.push(`- Contributi/licenze di terzi: ${safeStr(data.thirdPartyContrib)}`);
  lines.push(`- Dettagli terzi: ${safeStr(data.thirdPartyDetails)}`);
  lines.push("");

  lines.push("== 15) Caricamento finale e note ==");
  lines.push(`- Note finali: ${safeStr(data.finalNotes)}`);
  lines.push("");

  return lines.join("\n");
}

app.post("/api/submit", upload.array("attachments", 20), async (req, res) => {
  try {
    if (safeStr(req.body.website)) return res.status(200).json({ ok: true });

    const data = parseJsonField(req, "payload");
    required(data, "Payload mancante.");

    required(data.privacyViewed === true, "Privacy: presa visione obbligatoria.");
    required(data.contactConsent === true, "Consenso contatto obbligatorio.");
    required(["Persona fisica", "Azienda/Ente", "Più soggetti (contitolarità)"].includes(data.applicantType), "Tipo richiedente non valido.");
    required(safeStr(data.inventionTitle).length > 0, "Titolo invenzione obbligatorio.");
    required(safeStr(data.technicalField).length > 0, "Campo tecnico obbligatorio.");
    required(safeStr(data.pitch).length > 0, "Riassunto invenzione obbligatorio.");
    required(safeStr(data.priorArtDescription).length > 0, "Stato dell’arte: descrizione obbligatoria.");
    required(safeStr(data.technicalProblem).length > 0, "Problema tecnico obbligatorio.");
    required(safeStr(data.solution).length > 0, "Soluzione proposta obbligatoria.");
    required(safeStr(data.advantages).length > 0, "Vantaggi tecnici obbligatori.");
    required(safeStr(data.innovativeFeatures).length > 0, "Caratteristiche innovative obbligatorie.");
    required(Array.isArray(data.inventionTypes) && data.inventionTypes.length > 0, "Tipologia di invenzione obbligatoria.");
    required(["No", "Sì", "Non so"].includes(data.disclosed), "Divulgazione: selezione obbligatoria.");
    required(["No", "Sì", "Non so"].includes(data.universityCollab), "Collaborazione università: selezione obbligatoria.");

    if (data.applicantType === "Azienda/Ente") {
      required(safeStr(data.company?.name).length > 0, "Azienda: denominazione obbligatoria.");
      required(safeStr(data.company?.hq).length > 0, "Azienda: sede legale obbligatoria.");
      required(safeStr(data.company?.country).length > 0, "Azienda: paese obbligatorio.");
      required(safeStr(data.company?.email).length > 0, "Azienda: email obbligatoria.");
    } else if (data.applicantType === "Persona fisica") {
      required(safeStr(data.person?.fullName).length > 0, "Persona: nome e cognome obbligatorio.");
      required(safeStr(data.person?.residence).length > 0, "Persona: residenza obbligatoria.");
      required(safeStr(data.person?.country).length > 0, "Persona: paese obbligatorio.");
      required(safeStr(data.person?.email).length > 0, "Persona: email obbligatoria.");
    }

    required(Array.isArray(data.inventors) && data.inventors.length > 0, "Inserire almeno un inventore.");
    required(safeStr(data.inventors[0]?.fullName).length > 0, "Inventore 1: nome e cognome obbligatorio.");

    const files = req.files || [];
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return res.status(400).json({ ok: false, error: `Allegati troppo grandi. Limite totale: ${MAX_TOTAL_MB} MB.` });
    }

    const recipient = process.env.RECIPIENT_EMAIL;
    required(recipient, "RECIPIENT_EMAIL non configurata.");

    const transporter = makeTransporter();

    const applicantLabel =
      data.applicantType === "Azienda/Ente"
        ? safeStr(data.company?.name)
        : data.applicantType === "Persona fisica"
          ? safeStr(data.person?.fullName)
          : "Contitolarità";

    const subject = `Questionario brevetto – ${safeStr(data.inventionTitle)} – ${applicantLabel || "Richiedente"}`;
    const text = formatEmailText(data);

    const attachments = files.map((f) => ({
      filename: f.originalname,
      content: f.buffer,
      contentType: f.mimetype
    }));

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: recipient,
      replyTo:
        data.applicantType === "Azienda/Ente"
          ? safeStr(data.company?.email) || undefined
          : data.applicantType === "Persona fisica"
            ? safeStr(data.person?.email) || undefined
            : undefined,
      subject,
      text,
      attachments
    });

    return res.json({ ok: true });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, error: err.message || "Errore interno." });
  }
});

app.get("/health", (req, res) => res.send("OK"));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Server avviato su http://localhost:${port}`));
