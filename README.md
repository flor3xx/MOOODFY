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

## Autenticazione (email + password)

Rotte disponibili:

| Rotta | Cosa fa |
| --- | --- |
| `/auth/login` | Form di accesso (email + password) |
| `/auth/sign-up` | Form di registrazione (email + password + conferma) |
| `/auth/callback` | Scambio del codice di conferma arrivato via email con una sessione, poi redirect a `/` |
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
- Nessun evento analytics viene inviato per l'autenticazione e nessun indirizzo email viene passato
  a Vercel Analytics. Il consenso analytics resta invariato e indipendente dall'account.
- **Nessuna autorizzazione in questo slice:** non esistono ruoli o dati protetti. Non si usa
  `user_metadata` per decisioni di sicurezza (sarebbe modificabile dall'utente): quando servirà,
  i dati di autorizzazione andranno in `app_metadata` e le policy RLS verificheranno `auth.uid()`.

### Impostazioni Supabase Auth da verificare

Il comportamento dipende dalla configurazione del progetto (Dashboard → Authentication):

1. Provider **Email** attivo (`Authentication → Providers → Email`).
2. **Conferma email**: se è richiesta (impostazione predefinita consigliata), dopo la registrazione
   l'utente deve aprire il link ricevuto e viene reindirizzato su `/auth/callback`; se non lo è, la
   sessione parte subito. L'app gestisce entrambi i casi con messaggi diversi — non disattivare la
   conferma solo per comodità, perché indebolisce gli account.
3. **URL di reindirizzamento**: `Authentication → URL Configuration` deve includere
   `http://localhost:3000/**` in sviluppo e `https://<dominio>/auth/callback` in produzione. Il link
   di conferma usa `NEXT_PUBLIC_SITE_URL` + `/auth/callback` (vedi sopra) e Supabase rifiuta URL non
   in allow list; senza `NEXT_PUBLIC_SITE_URL` valgono il Site URL e i redirect predefiniti del
   progetto.
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
- Nessun evento custom è inviato in questo slice; nessuna ricerca, email, nickname o URL di
  amministrazione viene inviata. Le pagine di autenticazione non inviano eventi: email e password
  non possono finire in Analytics.
- La scelta si può cambiare o revocare da “Preferenze analytics” nel footer.
- Logica testabile in `lib/consent.ts`, test in `lib/consent.test.ts`.

## Database

`supabase/migrations/` contiene lo schema: `0001` crea `public.dimensions` e `public.dimension_values`
con i valori approvati delle tre dimensioni (RLS attiva in sola lettura per anon/authenticated);
`0002` aggiunge catalogo e classificazioni comunitarie; `0003` aggiunge l'indice di copertura della
chiave esterna composta. Tutte sono idempotenti: si possono riapplicare. Lo schema completo (tracce,
voti, gamification) è volutamente fuori scope.

La homepage **legge** la tassonomia da Supabase in sola lettura (`lib/dimensions-server.ts`): due
`select` limitate (`id,slug,label,sort_order` e `dimension_id,value,sort_order`, con `order` esplicito)
sulle due tabelle pubbliche, con la chiave publishable e RLS come unica barriera. Se le variabili
pubbliche mancano, il client non è disponibile, la lettura viene rifiutata o i dati non contengono una
tassonomia utilizzabile, la pagina ripiega sul vocabolario locale di `lib/dimensions.ts` e lo dichiara
nello stato (“Da Supabase” oppure “Fallback locale”). Nessun messaggio di errore di Supabase viene
mostrato o registrato. Nessuna scrittura, nessuna chiave `service_role`.

## Struttura

```
app/                    layout, homepage, globals.css (token RawBlock), loading
app/api/search/         route GET /api/search (JSON, server-only)
app/auth/               pagine login/sign-up, Server Functions, callback e sign-out
components/             pannello consenso + loader analytics, form di autenticazione
lib/                    consenso, provider MusicBrainz (server-only), validazione auth,
                        seam Supabase (env, client browser, client server, proxy),
                        dimensioni (vocabolario + mapping puro, lettura Supabase server-only)
proxy.ts                refresh dei cookie di sessione su / e /auth/* (nessun redirect)
supabase/migrations/    SQL: dimensioni/valori, catalogo e classificazioni
```

## Fuori scope (prossimi slice)

Filtri e voto su Mood/Energia/Atmosfera, persistenza catalogo e voti, ruoli/area amministrativa,
gamification, immagini copertina, link ai servizi di streaming.
