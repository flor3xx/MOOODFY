# MOOODFY

Prototipo di scoperta musicale per **Mood**, **Energia** e **Atmosfera**.
Ricerca testuale su MusicBrainz e autenticazione email/password **implementate**; filtri per
dimensione, voto, classificazioni e area amministrativa **non sono implementati**.

Linea visiva: [RawBlock](./rawblock-DESIGN.md) (fonte di verità del design, non modificare).
Stack: Next.js App Router + TypeScript, Supabase/PostgreSQL (Auth + Postgres), MusicBrainz come
provider di metadati iniziale.

## Requisiti

Node.js >= 20 (testato con Node 24) e npm.

## Setup

```bash
npm install
cp .env.example .env.local   # opzionale: senza variabili l'app parte, con stati "non configurato"
npm run dev                  # http://localhost:3000
```

## Variabili d'ambiente

Solo valori pubblici, mai segreti:

| Variabile | Descrizione |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del progetto Supabase (pubblico) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chiave **publishable** del progetto: pubblica, protetta da RLS |
| `NEXT_PUBLIC_SITE_URL` | Origine pubblica del sito, usata solo per costruire il link di conferma email (`<site>/auth/callback`). In locale `http://localhost:3000` |
| `MUSICBRAINZ_USER_AGENT` | User-Agent inviato a MusicBrainz. **Non è un segreto, ma è obbligatorio** per la ricerca live |

Senza le variabili Supabase l'app funziona lo stesso: la homepage legge la tassonomia approvata da
Supabase quando è configurato e raggiungibile, altrimenti mostra il vocabolario locale e lo dichiara
nello stato del prototipo.
La chiave `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` è **pubblica** (sostituisce la vecchia nomenclatura
`anon key`): viene inclusa nel bundle del browser ed è protetta dalle policy RLS.
Non inserire mai una chiave `service_role` o `secret`: quei valori aggirano RLS e non devono mai
comparire in variabili `NEXT_PUBLIC_*` né nel repository.
I client Supabase sono creati su richiesta in `lib/supabase/*` e non vengono mai istanziati a build
time. Senza queste variabili le pagine di accesso mostrano uno stato “non configurato” invece di
fallire.

### `NEXT_PUBLIC_SITE_URL`

Serve solo a comporre il link di conferma email: `lib/site-url.ts` valida il valore (URL assoluto
http/https, senza credenziali, query o frammento), toglie la barra finale e aggiunge
`/auth/callback`. In sviluppo:

```bash
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
```

- La stessa origine (e in particolare `/auth/callback`) deve essere in allow list in Supabase:
  `Authentication → URL Configuration`.
- Se la variabile manca o non è valida il redirect viene **omesso**: la registrazione funziona
  comunque e Supabase usa il redirect predefinito del progetto.
- L'origine **non viene mai** presa dall'header `Host` della richiesta: un host controllabile
  dall'utente potrebbe puntare il link di conferma verso un altro sito.
- È un valore pubblico (nessun segreto): non stampare né registrare il valore nei log.

### MusicBrainz (`MUSICBRAINZ_USER_AGENT`)

MusicBrainz non richiede chiavi API, ma rifiuta le richieste senza uno User-Agent significativo.
Il valore deve identificare l'app e un contatto reale, ad esempio:

```bash
MUSICBRAINZ_USER_AGENT="MOOODFY/0.1 (https://esempio.example; contatto@esempio.example)"
```

Non esiste un valore di default e il codice non inventa un'identità di contatto. Senza questa
variabile la ricerca risponde con uno stato onesto e riconoscibile:

- UI: “Ricerca non configurata su questo ambiente: sul server manca MUSICBRAINZ_USER_AGENT.”
- API: `503 {"ok":false,"code":"not_configured"}`

Nessuna richiesta viene inviata al provider in questo caso.

## Ricerca

- `GET /api/search?q=<testo>` — JSON pubblico usato dalla UI e dai client futuri.
  Risposte: `{"ok":true,"results":[...]}` oppure `{"ok":false,"code":"..."}` con
  `400 invalid_query`, `503 not_configured`, `502 provider_error`/`malformed_response`, `504 timeout`.
  La ricerca **non richiede accesso**: le rotte pubbliche restano pubbliche anche con l'autenticazione.
- La homepage invia la ricerca via form (`GET /?q=...`), quindi la query resta nell'URL ed è
  condividibile; i risultati sono renderizzati lato server, senza stato client.
- La validazione (lunghezza 1–100 caratteri, trim, spazi normalizzati) avviene **sempre** lato
  server, anche per le query costruite a mano nell'URL.
- Campi normalizzati per la UI: MBID della recording, titolo, artisti, titolo del release/group,
  prima data di pubblicazione e URL canonico `https://musicbrainz.org/recording/<mbid>`.
  Nessun salvataggio: i risultati vivono solo nella risposta.
- **Limite del prototipo:** MusicBrainz chiede circa **una richiesta al secondo** per client e non
  usiamo un dataset locale né caching. Non usare questa ricerca in produzione commerciale: il
  passaggio previsto è un dataset core CC0 in locale o un accordo approvato con MetaBrainz
  (checkpoint di licenza, vedi https://musicbrainz.org/doc/MusicBrainz_API). Il provider è isolato
  in `lib/musicbrainz.ts` (server-only) proprio per rendere quel cambio economico.
- Nessun evento analytics viene inviato per le ricerche.

## Scheda del brano (`/songs/[mbid]`)

- Il titolo di ogni risultato di ricerca porta a una **scheda interna** `/songs/<mbid>`, non più
  direttamente a MusicBrainz; accanto resta un link esplicito alla scheda originale
  (`https://musicbrainz.org/recording/<mbid>`, nuova scheda, `rel="noopener noreferrer"`).
- La scheda mostra titolo, artista/i, album, prima pubblicazione, MBID e il link canonico. I dati
  arrivano da `GET /ws/2/recording/<mbid>?fmt=json&inc=artist-credits+releases` tramite lo stesso
  seam server-only `lib/musicbrainz.ts` (`lookupRecording`), normalizzati nella stessa forma stabile
  della ricerca. Nessun payload del provider viene salvato o mostrato.
- **Validazione**: il parametro è accettato solo come UUID/MBID canonico (con o senza trattini, in
  qualunque caso); la forma canonica viene ricostruita dai soli caratteri esadecimali, quindi non può
  aggiungere segmenti o parametri alla URL del provider.
- **Stati**: un MBID malformato viene rifiutato in `proxy.ts` con un **404 reale** prima che React
  renderizzi (una risposta già in streaming non può più cambiare lo status: vedi la sezione
  “Status codes” della documentazione Next). Un MBID valido ma sconosciuto mostra la pagina
  “Brano non trovato” con il tag `noindex` iniettato da Next (soft 404 documentato). Restano distinti
  gli stati *non configurato*, *timeout*, *errore del provider* e *risposta malformata*.
- **Onestà dello slice**: la scheda dichiara esplicitamente che classificazione, percentuali della
  community e link ai servizi di streaming **non sono attivi**; il pulsante di voto è `disabled`,
  non è dentro un form e non invia nulla.
- Nessuna scrittura su Supabase e nessun evento analytics.

## Autenticazione (email + password)

Rotte disponibili:

| Rotta | Cosa fa |
| --- | --- |
| `/auth/login` | Form di accesso (email + password) |
| `/auth/sign-up` | Form di registrazione (email + password + conferma) |
| `/auth/confirm` | **Percorso consigliato di conferma email (SSR)**: verifica `token_hash` + `type` con `verifyOtp`, poi redirect a `/` |
| `/auth/callback` | Fallback retro-compatibile per i link PKCE `?code=` (scambio codice → sessione) |
| `/auth/sign-out` | Solo `POST`: chiude la sessione e reindirizza a `/` (`GET` risponde `405`) |

Come è costruita:

- I form sono inviati a **Server Functions** (`app/auth/actions.ts`): email e password non passano
  mai dall'URL e non vengono registrate nei log. La validazione è ripetuta sul server (email
  valida e ≤ 254 caratteri, password 8–72 caratteri, conferma coincidente); gli attributi HTML
  (`required`, `minLength`, `type=email`) sono solo un'anticipazione lato browser.
- La sessione vive in cookie (`sb-<ref>-auth-token`) scritti dal client server-side
  (`lib/supabase/server.ts`, creato per richiesta con `cookies()`).
- `proxy.ts` (root, Next 16) **rinfresca soltanto** la sessione sui percorsi `/` e `/auth/*` con
  `getClaims()`, applicando gli header `Cache-Control`/`Expires`/`Pragma` al response. Non
  reindirizza e non autorizza nulla: le pagine pubbliche restano pubbliche.
- Le identità si verificano sempre con `getClaims()` (mai `getSession()`, che si fida del cookie).
  Un cookie manomesso non produce alcuno stato autenticato; una risposta non viene mai messa in
  cache insieme ai cookie di sessione.
- Errori del provider mappati su messaggi fissi (`lib/auth-messages.ts`): nessun testo grezzo di
  Supabase arriva al client.
- **Password**: la Server Function la invia a Supabase Auth senza registrarla o salvarla nelle
  tabelle dell'app. Supabase Auth conserva solo un hash bcrypt con salt casuale in
  `auth.users.encrypted_password`; MOOODFY non può leggere una password in chiaro.
- Nessun evento analytics viene inviato per l'autenticazione e nessun indirizzo email viene passato
  a Vercel Analytics. Il consenso analytics resta invariato e indipendente dall'account.
- **Nessuna autorizzazione in questo slice:** non esistono ruoli o dati protetti. Non si usa
  `user_metadata` per decisioni di sicurezza (sarebbe modificabile dall'utente): quando servirà,
  i dati di autorizzazione andranno in `app_metadata` e le policy RLS verificheranno `auth.uid()`.

### Conferma email (flusso consigliato SSR)

Il link di conferma deve puntare a **`/auth/confirm`** con un token hash, non allo scambio codice:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

`app/auth/confirm/route.ts` accetta solo i tipi di conferma email (`email`, `signup`), chiama
`supabase.auth.verifyOtp({ type, token_hash })` con il client SSR e reindirizza solo a percorsi
interni fissi (`/` in caso di successo, `/auth/login?errore=link` in caso di fallimento). Il token non
viene mai mostrato, registrato o rimesso nella URL: non ci sono redirect aperti.

Perché serve: lo scambio `?code=` di `/auth/callback` richiede il *code verifier* PKCE salvato nel
browser che ha iniziato la registrazione. Aprendo l'email da un altro browser, da un altro dispositivo
o dal browser in-app di un provider di posta, quel verificatore non c'è → Supabase risponde `400` su
`/token` e l'utente vede “Il link di conferma non è valido o è scaduto.” La verifica con `token_hash`
non dipende da nessuno stato salvato nel browser, quindi funziona in tutti questi casi.
`/auth/callback` resta attivo solo come fallback per i link vecchi: nessuna rottura per chi ha ancora
il template precedente.

**Azione manuale richiesta (non automatizzabile da qui):**

1. Supabase Dashboard → **Authentication → Email Templates → Confirm signup**: imposta il link a
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
2. **Authentication → URL Configuration**: imposta il **Site URL** all'origine pubblica
   (in produzione `https://<dominio>`, in locale `http://localhost:3000`) e aggiungi
   `https://<dominio>/**` (e `http://localhost:3000/**`) agli URL di reindirizzamento. `{{ .SiteURL }}`
   è il Site URL del progetto: se è sbagliato, la conferma fallisce.

Nessuna migrazione SQL può modificare i template email o il Site URL: è una verifica manuale.

### Impostazioni Supabase Auth da verificare

Il comportamento dipende dalla configurazione del progetto (Dashboard → Authentication):

1. Provider **Email** attivo (`Authentication → Providers → Email`).
2. **Conferma email**: se è richiesta (impostazione predefinita consigliata), dopo la registrazione
   l'utente deve aprire il link ricevuto e viene reindirizzato su `/auth/confirm` (vedi la sezione
   sopra); il fallback `/auth/callback` copre i template che usano ancora `{{ .ConfirmationURL }}`.
   Se la conferma non è richiesta, la sessione parte subito. L'app gestisce entrambi i casi con
   messaggi diversi — non disattivare la conferma solo per comodità, perché indebolisce gli account.
3. **URL di reindirizzamento**: `Authentication → URL Configuration` deve includere
   `http://localhost:3000/**` in sviluppo e `https://<dominio>/**` in produzione (in particolare
   `/auth/confirm` e `/auth/callback`). Il link di conferma usa `{{ .SiteURL }}` dal template, quindi
   il **Site URL** deve essere l'origine pubblica corretta; Supabase rifiuta URL non in allow list.
   Anche `NEXT_PUBLIC_SITE_URL` + `/auth/callback` resta il redirect usato dalla registrazione (vedi
   sopra) e senza `NEXT_PUBLIC_SITE_URL` valgono il Site URL e i redirect predefiniti del progetto.
4. **Rate limit email**: il piano gratuito invia poche email all'ora; in caso di superamento la UI
   mostra “Abbiamo inviato troppe email: riprova tra qualche minuto.”
5. Password: minimo 8 caratteri imposto anche lato app. Se l'app deve rispettare i requisiti esterni
   di forza password (leaked password protection, MFA), la configurazione va allineata in Dashboard.

`lib/auth-validation.ts` è il seam testabile (`lib/auth-validation.test.ts`).

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `npm run dev` | Server di sviluppo |
| `npm run build` | Build di produzione |
| `npm start` | Avvia la build di produzione |
| `npm run lint` | ESLint (config Next flat) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Test di comportamento (consenso, provider ricerca, validazione auth), `node --test` |

## Analytics e consenso

`@vercel/analytics` è installato ma **non attivo finché non accetti**: lo stato di partenza è
sconosciuto, e sconosciuto significa negato.

- La scelta (`granted` / `denied`) è salvata solo in `localStorage` (`mooodfy.analytics-consent`),
  nessuna identità utente, nessun cookie di profilazione.
- Il componente `<Analytics mode="production" />` viene montato **solo** dopo un consenso
  esplicito, quindi lo script non è presente nell'HTML iniziale e non c'è disallineamento di
  idratazione (lo stato viene letto via `useSyncExternalStore` con snapshot server “nessuna scelta”).
- In sviluppo locale o su hosting diverso da Vercel il loader resta disattivato, così non viene
  richiesto `/_vercel/insights/script.js` fuori dalla piattaforma che lo serve. Su Vercel resta
  necessario il consenso esplicito.
- Nessun evento custom è inviato in questo slice; nessuna ricerca, email, nickname o URL di
  amministrazione viene inviata. Le pagine di autenticazione non inviano eventi: email e password
  non possono finire in Analytics.
- La scelta si può cambiare o revocare da “Preferenze analytics” nel footer.
- Logica testabile in `lib/consent.ts`, test in `lib/consent.test.ts`.

## Database

`supabase/migrations/` contiene lo schema: `0001` crea `public.dimensions` e `public.dimension_values`
con i valori approvati delle tre dimensioni (RLS attiva in sola lettura per anon/authenticated);
`0002` aggiunge catalogo e classificazioni comunitarie; `0003` aggiunge l'indice di copertura della
chiave esterna composta; `0004` aggiunge `songs.created_by`, aggiorna la visibilità dei brani e crea la
funzione atomica `public.classify_song`. Tutte sono idempotenti: si possono riapplicare. Lo schema
completo (gamification, area amministrativa) è volutamente fuori scope.
Le migrazioni si applicano solo con il processo di revisione approvato: l'applicazione non applica mai
schema da sé.

La homepage **legge** la tassonomia da Supabase in sola lettura (`lib/dimensions-server.ts`): due
`select` limitate (`id,slug,label,sort_order` e `dimension_id,value,sort_order`, con `order` esplicito)
sulle due tabelle pubbliche, con la chiave publishable e RLS come unica barriera. Se le variabili
pubbliche mancano, il client non è disponibile, la lettura viene rifiutata o i dati non contengono una
tassonomia utilizzabile, la pagina ripiega sul vocabolario locale di `lib/dimensions.ts` e lo dichiara
nello stato (“Da Supabase” oppure “Fallback locale”). Nessun messaggio di errore di Supabase viene
mostrato o registrato. Nessuna scrittura, nessuna chiave `service_role`.

## Classificazione (primo slice di scrittura)

- Nella scheda del brano un utente **autenticato** sceglie un valore per Mood, Energia e Atmosfera e
  invia il form (`components/classify-form.tsx` → Server Function `app/songs/[mbid]/actions.ts`).
  Chi non ha una sessione vede un link ad `/auth/login`, non un voto finto.
- La Server Function non si fida del browser: rivalida l'MBID con `normalizeMbid`, ricontrolla i tre
  valori contro il vocabolario approvato (`lib/classification.ts`), **rilegge la registrazione da
  MusicBrainz** e ignora qualunque titolo/artista inviato dal client, quindi risolve gli id dei valori
  dalle tabelle pubbliche di riferimento. I guasti diventano messaggi fissi in italiano: nessun errore
  grezzo arriva in pagina.
- La scrittura è **una sola chiamata** a `public.classify_song`: importa o riusa il brano
  (`song_sources` con `provider='musicbrainz'` e URL canonico costruito dall'MBID), lo porta a
  `community_pending` se era `external`, e inserisce/aggiorna le tre righe di classificazione
  dell'utente, tutto in una transazione. Il brano rifiutato (`rejected`) non è classificabile.
- La funzione è `SECURITY DEFINER` **per necessità**: è l'unico punto che scrive
  `songs`/`song_sources`/`classification_votes`. `authenticated` non ha più grant di scrittura diretti
  su quelle tabelle (0004 li revoca) e `execute` sulla funzione è revocato da `PUBLIC` e `anon`,
  concesso solo ad `authenticated`. La funzione impone `set search_path = ''`, pretende `auth.uid()`
  non nullo, non accetta mai uno `user_id` come argomento e rivalida ogni valore contro le dimensioni.
- Visibilità: i brani pubblicati restano pubblici; un brano `external`/`community_pending` è visibile
  a chi lo ha creato e a chi lo ha classificato, mai a chi non ha votato e mai a `anon`.
- **Fuori da questo slice**: percentuali della community, transizione automatica a
  `community_validated`, badge, area amministrativa e link ai servizi di streaming. Nessun evento
  analytics viene inviato per la classificazione.

## Struttura

```
app/                    layout, homepage, globals.css (token RawBlock), loading
app/api/search/         route GET /api/search (JSON, server-only)
app/songs/[mbid]/       scheda brano: page, loading, not-found, actions (classify_song)
app/auth/               pagine login/sign-up, Server Functions, conferma (confirm), callback e sign-out
components/             pannello consenso + loader analytics, form di autenticazione,
                        form di classificazione
lib/                    consenso, provider MusicBrainz (server-only: ricerca + lookup),
                        validazione auth, validazione/mappatura errori di classificazione,
                        seam Supabase (env, client browser, client server, proxy),
                        dimensioni (vocabolario + mapping puro, lettura Supabase server-only)
proxy.ts                refresh dei cookie di sessione e rifiuto degli MBID malformati (nessun redirect)
supabase/migrations/    SQL: dimensioni/valori, catalogo e classificazioni, funzione atomica
```

## Fuori scope (prossimi slice)

Filtri e voto su Mood/Energia/Atmosfera, persistenza catalogo e voti, percentuali della community,
ruoli/area amministrativa, gamification, immagini copertina, link ai servizi di streaming.
