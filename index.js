/**
 * Cloud Function: caricaComputoSuDrive (onRequest con CORS manuale)
 * Riceve un PDF (in base64) dall'app gestionale e lo carica nella cartella
 * "Computi Metrici" del Drive aziendale, usando il service account.
 */
const functions = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();

const SA_KEY = defineSecret("SA_KEY");
const DRIVE_FOLDER_ID = defineSecret("DRIVE_FOLDER_ID");

function getDriveClient() {
  const credentials = JSON.parse(SA_KEY.value());
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

async function verificaAuth(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const idToken = header.split("Bearer ")[1];
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    return null;
  }
}

exports.caricaComputoSuDrive = functions.onRequest(
  { region: "europe-west1", memory: "512MiB", timeoutSeconds: 120, secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Metodo non consentito" }); return; }

    const utente = await verificaAuth(req);
    if (!utente) { res.status(401).json({ error: "Non autenticato" }); return; }

    const { fileBase64, fileName, cantiereNome, cantiereId } = req.body || {};
    if (!fileBase64 || !fileName) { res.status(400).json({ error: "File mancante" }); return; }
    if (!cantiereId) { res.status(400).json({ error: "Cantiere mancante" }); return; }

    // verifica permessi: deve essere il creatore del cantiere OPPURE admin
    try {
      const db = admin.firestore();
      const cantiereDoc = await db.collection("gc_cantieri").doc(cantiereId).get();
      if (!cantiereDoc.exists) { res.status(404).json({ error: "Cantiere non trovato" }); return; }
      const creatoDa = cantiereDoc.data().creatoDa;

      let isAdmin = false;
      const utenteDoc = await db.collection("utenti").doc(utente.uid).get();
      if (utenteDoc.exists && utenteDoc.data().ruolo === "admin") isAdmin = true;

      if (creatoDa !== utente.uid && !isAdmin) {
        res.status(403).json({ error: "Non autorizzato: solo il creatore del cantiere o l'admin" });
        return;
      }
    } catch (e) {
      res.status(500).json({ error: "Verifica permessi fallita: " + e.message });
      return;
    }

    try {
      const drive = getDriveClient();
      const folderId = DRIVE_FOLDER_ID.value();
      let parentId = folderId;
      if (cantiereNome) {
        parentId = await getOrCreateSubfolder(drive, folderId, cantiereNome);
      }
      const buffer = Buffer.from(fileBase64, "base64");
      const { Readable } = require("stream");
      const stream = Readable.from(buffer);
      const result = await drive.files.create({
        requestBody: { name: fileName, parents: [parentId] },
        media: { mimeType: "application/pdf", body: stream },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      res.status(200).json({ ok: true, fileId: result.data.id, link: result.data.webViewLink });
    } catch (err) {
      console.error("Errore upload Drive:", err);
      const dettaglio = (err && err.errors && err.errors[0] && err.errors[0].message)
        || (err && err.message) || "errore sconosciuto";
      res.status(500).json({ error: "Drive: " + dettaglio });
    }
  }
);

async function getOrCreateSubfolder(drive, parentId, nome) {
  const safe = nome.replace(/'/g, "\\'");
  const q = `name='${safe}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id)", supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }
  const created = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id;
}

// Elenca i PDF caricati per un cantiere (restituisce nome + link di visualizzazione)
exports.elencaComputiDrive = functions.onRequest(
  { region: "europe-west1", memory: "256MiB", secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const utente = await verificaAuth(req);
    if (!utente) { res.status(401).json({ error: "Non autenticato" }); return; }

    // accetta cantiereNome e cantiereId via query o body
    const cantiereNome = (req.query && req.query.cantiere) || (req.body && req.body.cantiereNome) || "";
    const cantiereId = (req.query && req.query.cantiereId) || (req.body && req.body.cantiereId) || "";
    if (!cantiereNome) { res.status(200).json({ ok: true, files: [] }); return; }

    // verifica permessi: solo creatore del cantiere o admin
    if (cantiereId) {
      try {
        const db = admin.firestore();
        const cantiereDoc = await db.collection("gc_cantieri").doc(cantiereId).get();
        if (cantiereDoc.exists) {
          const creatoDa = cantiereDoc.data().creatoDa;
          let isAdmin = false;
          const utenteDoc = await db.collection("utenti").doc(utente.uid).get();
          if (utenteDoc.exists && utenteDoc.data().ruolo === "admin") isAdmin = true;
          if (creatoDa !== utente.uid && !isAdmin) {
            res.status(403).json({ error: "Non autorizzato" });
            return;
          }
        }
      } catch (e) {
        res.status(500).json({ error: "Verifica permessi fallita: " + e.message });
        return;
      }
    }

    try {
      const drive = getDriveClient();
      const folderId = DRIVE_FOLDER_ID.value();
      // trovo la sottocartella del cantiere
      const safe = cantiereNome.replace(/'/g, "\\'");
      const qFolder = `name='${safe}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const folderList = await drive.files.list({
        q: qFolder, fields: "files(id)",
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      if (!folderList.data.files || folderList.data.files.length === 0) {
        res.status(200).json({ ok: true, files: [] }); return;
      }
      const subId = folderList.data.files[0].id;
      // elenco i PDF dentro la sottocartella
      const qFiles = `'${subId}' in parents and trashed=false`;
      const filesList = await drive.files.list({
        q: qFiles, fields: "files(id, name, webViewLink, createdTime)",
        orderBy: "createdTime desc",
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      const files = (filesList.data.files || []).map(f => ({
        id: f.id, name: f.name, link: f.webViewLink,
      }));
      res.status(200).json({ ok: true, files });
    } catch (e) {
      const dettaglio = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message;
      res.status(500).json({ error: "Drive: " + dettaglio });
    }
  }
);

// Scarica un singolo PDF e lo restituisce in base64 (per mostrarlo nell'app, file privati)
exports.scaricaComputo = functions.onRequest(
  { region: "europe-west1", memory: "512MiB", timeoutSeconds: 120, secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const utente = await verificaAuth(req);
    if (!utente) { res.status(401).json({ error: "Non autenticato" }); return; }

    const fileId = (req.query && req.query.fileId) || (req.body && req.body.fileId) || "";
    const cantiereId = (req.query && req.query.cantiereId) || (req.body && req.body.cantiereId) || "";
    if (!fileId) { res.status(400).json({ error: "File mancante" }); return; }

    // verifica permessi: solo creatore del cantiere o admin
    if (cantiereId) {
      try {
        const db = admin.firestore();
        const cantiereDoc = await db.collection("gc_cantieri").doc(cantiereId).get();
        if (cantiereDoc.exists) {
          const creatoDa = cantiereDoc.data().creatoDa;
          let isAdmin = false;
          const utenteDoc = await db.collection("utenti").doc(utente.uid).get();
          if (utenteDoc.exists && utenteDoc.data().ruolo === "admin") isAdmin = true;
          if (creatoDa !== utente.uid && !isAdmin) {
            res.status(403).json({ error: "Non autorizzato" });
            return;
          }
        }
      } catch (e) {
        res.status(500).json({ error: "Verifica permessi fallita: " + e.message });
        return;
      }
    }

    try {
      const drive = getDriveClient();
      const resp = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );
      const base64 = Buffer.from(resp.data).toString("base64");
      res.status(200).json({ ok: true, base64 });
    } catch (e) {
      const dettaglio = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message;
      res.status(500).json({ error: "Drive: " + dettaglio });
    }
  }
);

// Elimina un PDF dal Drive (solo creatore del cantiere o admin)
exports.eliminaComputoDrive = functions.onRequest(
  { region: "europe-west1", memory: "256MiB", secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Metodo non consentito" }); return; }
    const utente = await verificaAuth(req);
    if (!utente) { res.status(401).json({ error: "Non autenticato" }); return; }

    const { fileId, cantiereId } = req.body || {};
    if (!fileId) { res.status(400).json({ error: "File mancante" }); return; }

    // verifica permessi: solo creatore del cantiere o admin
    if (cantiereId) {
      try {
        const db = admin.firestore();
        const cantiereDoc = await db.collection("gc_cantieri").doc(cantiereId).get();
        if (cantiereDoc.exists) {
          const creatoDa = cantiereDoc.data().creatoDa;
          let isAdmin = false;
          const utenteDoc = await db.collection("utenti").doc(utente.uid).get();
          if (utenteDoc.exists && utenteDoc.data().ruolo === "admin") isAdmin = true;
          if (creatoDa !== utente.uid && !isAdmin) {
            res.status(403).json({ error: "Non autorizzato" });
            return;
          }
        }
      } catch (e) {
        res.status(500).json({ error: "Verifica permessi fallita: " + e.message });
        return;
      }
    }

    try {
      const drive = getDriveClient();
      // sposto nel cestino (più compatibile coi Drive condivisi del delete definitivo)
      await drive.files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      const dettaglio = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message;
      res.status(500).json({ error: "Drive: " + dettaglio });
    }
  }
);

exports.diagnosticaDrive = functions.onRequest(
  { region: "europe-west1", memory: "256MiB", secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const utente = await verificaAuth(req);
    if (!utente) { res.status(401).json({ error: "Non autenticato" }); return; }

    const report = {};
    try {
      const cred = JSON.parse(SA_KEY.value());
      report.serviceAccountEmail = cred.client_email;
      report.folderIdConfigurato = DRIVE_FOLDER_ID.value();
    } catch (e) {
      res.status(200).json({ ok: false, passo: "lettura_chiave", errore: e.message });
      return;
    }
    try {
      const drive = getDriveClient();
      const folderId = DRIVE_FOLDER_ID.value();
      const meta = await drive.files.get({
        fileId: folderId,
        fields: "id, name, mimeType, owners(emailAddress)",
        supportsAllDrives: true,
      });
      report.cartellaTrovata = true;
      report.nomeCartella = meta.data.name;
      report.proprietari = (meta.data.owners || []).map(o => o.emailAddress);
      res.status(200).json({ ok: true, report });
    } catch (e) {
      const dettaglio = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message;
      res.status(200).json({ ok: false, passo: "accesso_cartella", errore: dettaglio, report });
    }
  }
);
// ============================================================================
//  caricaConsuntivoSuDrive
//  Carica il file Word di un consuntivo su Drive, dentro  Consuntivi/<categoria>
//  (create in automatico). Chiamata dal programma desktop Gama Consuntivi, che
//  NON ha login: per questo si protegge con un token condiviso invece di verificaAuth.
//  Riusa SA_KEY + DRIVE_FOLDER_ID (gia' configurati) e ricava da solo il Drive
//  condiviso dalla cartella dei computi.
// ============================================================================
const TOKEN_CONSUNTIVI = "158d76892c820bfc66e50db1801e2457b3ed21bf61ded634";

exports.caricaConsuntivoSuDrive = functions.onRequest(
  { region: "europe-west1", memory: "512MiB", timeoutSeconds: 120, secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Metodo non consentito" }); return; }

    // protezione semplice: l'app desktop manda un token condiviso
    const tokenRicevuto = (req.body && req.body.token) || req.headers["x-token"] || "";
    if (tokenRicevuto !== TOKEN_CONSUNTIVI) { res.status(401).json({ error: "Token non valido" }); return; }

    const { fileBase64, fileName, categoria, consuntivoId } = req.body || {};
    if (!fileBase64 || !fileName || !categoria) {
      res.status(400).json({ error: "Parametri mancanti: servono fileBase64, fileName e categoria" });
      return;
    }

    try {
      const drive = getDriveClient();
      // ricavo il Drive condiviso dalla cartella dei computi (gia' configurata)
      const meta = await drive.files.get({
        fileId: DRIVE_FOLDER_ID.value(),
        fields: "driveId",
        supportsAllDrives: true,
      });
      const sharedDriveId = meta.data.driveId;
      if (!sharedDriveId) {
        res.status(500).json({ error: "Impossibile ricavare il Drive condiviso dalla cartella dei computi" });
        return;
      }
      // creo/trovo  Consuntivi/<categoria>  nel Drive condiviso
      const consuntiviRoot = await getOrCreateSubfolder(drive, sharedDriveId, "Consuntivi");
      const catId = await getOrCreateSubfolder(drive, consuntiviRoot, categoria);

      // carico il Word
      const buffer = Buffer.from(fileBase64, "base64");
      const { Readable } = require("stream");
      const stream = Readable.from(buffer);
      const result = await drive.files.create({
        requestBody: { name: fileName, parents: [catId] },
        media: {
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          body: stream,
        },
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
      });

      res.status(200).json({
        ok: true,
        fileId: result.data.id,
        name: result.data.name,
        link: result.data.webViewLink,
        categoria,
        consuntivoId: consuntivoId || null,
      });
    } catch (err) {
      console.error("Errore upload consuntivo Drive:", err);
      const dettaglio = (err && err.errors && err.errors[0] && err.errors[0].message)
        || (err && err.message) || "errore sconosciuto";
      res.status(500).json({ error: "Drive: " + dettaglio });
    }
  }
);

// ============================================================================
//  elencaConsuntiviDrive
//  Elenca i file dentro  Consuntivi/<categoria>  (per la pagina web).
//  Protetta da un token di SOLA LETTURA (diverso da quello di caricamento):
//  anche se finisce nel codice della pagina, permette solo di LEGGERE l'elenco.
//  Per aprire/scaricare un file serve comunque l'accesso al Drive (account Google).
// ============================================================================
const TOKEN_LISTA = "42c93fde15187744a4bd92b7d5074fb76709ed40e9871ea9";

// Trova una cartella per nome dentro un genitore (NON la crea). Ritorna id o null.
async function trovaCartella(drive, nome, parentId) {
  const safe = nome.replace(/'/g, "\\'");
  const q = `name='${safe}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({
    q, fields: "files(id)",
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return (list.data.files && list.data.files.length > 0) ? list.data.files[0].id : null;
}

exports.elencaConsuntiviDrive = functions.onRequest(
  { region: "europe-west1", memory: "256MiB", secrets: [SA_KEY, DRIVE_FOLDER_ID] },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const token = (req.query && req.query.token) || (req.body && req.body.token) || req.headers["x-token"] || "";
    if (token !== TOKEN_LISTA) { res.status(401).json({ error: "Token non valido" }); return; }

    const categoria = (req.query && req.query.categoria) || (req.body && req.body.categoria) || "";
    if (!categoria) { res.status(400).json({ error: "Categoria mancante" }); return; }

    try {
      const drive = getDriveClient();
      const meta = await drive.files.get({
        fileId: DRIVE_FOLDER_ID.value(), fields: "driveId", supportsAllDrives: true,
      });
      const sharedDriveId = meta.data.driveId;
      const consuntiviRoot = await trovaCartella(drive, "Consuntivi", sharedDriveId);
      if (!consuntiviRoot) { res.status(200).json({ ok: true, files: [] }); return; }
      const catId = await trovaCartella(drive, categoria, consuntiviRoot);
      if (!catId) { res.status(200).json({ ok: true, files: [] }); return; }

      const filesList = await drive.files.list({
        q: `'${catId}' in parents and trashed=false`,
        fields: "files(id, name, webViewLink, createdTime)",
        orderBy: "createdTime desc",
        supportsAllDrives: true, includeItemsFromAllDrives: true,
        pageSize: 1000,
      });
      const files = (filesList.data.files || []).map((f) => ({
        id: f.id, name: f.name, link: f.webViewLink, data: f.createdTime,
      }));
      res.status(200).json({ ok: true, files });
    } catch (e) {
      const dettaglio = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message;
      res.status(500).json({ error: "Drive: " + dettaglio });
    }
  }
);
