# Pezzo 3 — La pagina web dei consuntivi

Due cose: (A) ri-pubblicare le funzioni con quella nuova di elenco, (B) mettere
online la pagina.

---

## A) Aggiornare le funzioni su Firebase

1. Prendi il file **`index.js`** nuovo che ti ho dato e mettilo nella cartella
   **`functions`** al posto di quello attuale (lo sovrascrivi). Dentro c'è tutto
   come prima + la funzione nuova `elencaConsuntiviDrive`.
2. Apri il terminale nella cartella del progetto (barra indirizzo → `cmd` → Invio).
3. Dai questi due comandi (il primo è il trucco del timeout che ha funzionato):
   ```
   $env:FUNCTIONS_DISCOVERY_TIMEOUT="120"
   ```
   ```
   firebase deploy --only functions:elencaConsuntiviDrive
   ```
4. Aspetta "Deploy complete!". Fatto.

> La funzione di caricamento (`caricaConsuntivoSuDrive`) resta com'è, non la tocchiamo.

---

## B) Mettere online la pagina

La pagina è il file **`index.html`**. Va su GitHub Pages, come gli altri tuoi siti.

**Modo semplice (sito nuovo dedicato):**
1. Su GitHub crea un repository nuovo, es. **`archivio-consuntivi`**
2. Carica dentro il file **`index.html`**
3. Vai in **Settings → Pages** e attiva GitHub Pages (branch `main`)
4. Dopo qualche minuto la pagina è online all'indirizzo che ti dà GitHub
   (tipo `https://servizidc.github.io/archivio-consuntivi/`)

> Il file DEVE chiamarsi `index.html` (così si apre da solo).

---

## C) La prova del nove (tutto insieme)

1. Assicurati di aver installato il programma desktop nuovo (v3.18.0)
2. **Crea un consuntivo** qualsiasi (es. CBRE)
3. Apri la **pagina** (l'indirizzo del punto B)
4. Clicca sulla sezione **CBRE** → deve comparire il documento che hai appena
   creato, con il pulsante **Scarica** ☁️

Le sezioni in alto (CBRE, CREVAL, DUSSMANN, Preventivi) mostrano ognuna i propri
file. Il pulsante "Scarica" apre il file su Drive (devi essere collegato col tuo
account Google che ha accesso al Drive).

---

## Note

- La pagina mostra i **nomi** dei file a chiunque abbia l'indirizzo, ma per
  **aprirli/scaricarli** serve l'accesso al tuo Drive (account Google). Se vuoi
  più protezione (una password o un login), dimmelo e te la aggiungo.
- Se una sezione è vuota, la pagina lo dice ("Qui non c'è ancora niente").
- Il design (colori, titoli) lo possiamo cambiare come vuoi: è solo da dire.
