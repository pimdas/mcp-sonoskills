# SonoSkills Insights

Eigen analyseomgeving voor SonoSkills, bedoeld voor GitHub → Railway. Node.js 24, PostgreSQL en een Nederlandse dashboardinterface. Dit is de eerste dashboardversie; er is nog geen MCP-server of Exact Online-koppeling.

## Railway instellen

1. Voeg de GitHub-repository toe als Railway-service. De Dockerfile wordt gebruikt.
2. Voeg een PostgreSQL-service toe.
3. Stel onderstaande variables in op de dashboardservice:

| Variable | Waarde |
| --- | --- |
| `DATABASE_URL` | Railway-reference naar `${{Postgres.DATABASE_URL}}` (pas servicenaam aan indien nodig) |
| `ADMIN_EMAIL` | Jouw loginadres |
| `ADMIN_PASSWORD` | Een uniek wachtwoord van minimaal 16 tekens |
| `SESSION_SECRET` | Willekeurige geheime waarde van minimaal 32 tekens, bijvoorbeeld `openssl rand -hex 32` |
| `EDUFRAME_API_TOKEN` | Eduframe access token, alleen in Railway opslaan |
| `SYNC_INTERVAL_MINUTES` | Optioneel, standaard 60 en minimaal 15 |

`NODE_ENV=production` wordt door de Dockerfile ingesteld. Railway levert `PORT`. Maak onder Networking een HTTPS-domain aan. `/health` dient als healthcheck. Zonder login zijn geen analyses of data beschikbaar. Zonder API-key start het dashboard gewoon met een lege koppeling. Zonder database- of loginconfiguratie stopt de productie-app bewust met een configuratiefout.

Eduframe scopes voor deze import: `courses:read`, `enrollments:read`, `orders:read`, `invoices:read`, `settings:read` (cursuslocaties). `relations:read` is pas nodig voor toekomstige profielanalyses. Geen modify/destroy-scopes nodig. De connector doet uitsluitend GET-verzoeken.

## Inbegrepen

- Login met acht uur geldige, ondertekende HttpOnly/Secure/SameSite-cookies, verzoekbeveiliging en een limiet op loginpogingen. Eén beheeraccount via variables.
- Werkruimtes Alle cursussen, Vaste cursussen en Flexibele cursussen; selectie op het expliciete Eduframe-editietype.
- Categorieën (inclusief bovenliggende categorieën), templates en uitklapbare edities met eigen ID.
- Filters op categorie, template, locatie en periode. Vaste/alle cursussen: startdatum editie. Flexibele cursussen: boekingsdatum order, met inschrijfdatum als terugval.
- Cursusedities, actieve/afgeronde inschrijvingen, gewogen bezetting en terugkerende deelnemers.
- Boekingsmaand via orderdatum, met inschrijfdatum als terugval.
- Gefactureerd excl. btw en openstaand incl. btw, apart per valuta. Geen optelling van verschillende valuta; conceptfacturen uitgesloten. Dit is geen boekhoudkundige omzetverantwoording of daadwerkelijke betalingsanalyse.
- Cursusoverzicht en CSV-export voor Excel.
- Eerste import bij start en automatische/handmatige synchronisatie, cursorpaginering, begrensde retries en rate limiting.
- Volledige snapshot wordt pas atomair vervangen als alle resources succesvol zijn opgehaald. Vorige data blijft bij fouten beschikbaar. Verwijderde records verdwijnen bij de volgende succesvolle import.

## Definities en grenzen

Bij vaste/alle cursussen selecteert de periodefilter edities op hun startdatum, niet facturen op factuurdatum. Flexibele cursussen zonder startdatum vallen daar buiten een datumselectie. Gebruik de werkruimte Flexibele cursussen om op boekingsperiode te filteren. Daar blijven edities zichtbaar bij nul boekingen, en tellen facturen alleen mee via orders uit de geselecteerde boekingsperiode. Categoriefilters omvatten ook subcategorieën. Templates met beide editietypes verschijnen in beide werkruimtes, met alleen de bijbehorende edities. Na deze update is een succesvolle synchronisatie nodig voor categorieën en editietypes; oudere records met onbekend type worden niet gegokt. Inschrijvingen tellen alleen bij `active` en `completed`. Bezetting: som actieve/afgeronde inschrijvingen gedeeld door som bekende maximale capaciteiten, exclusief geannuleerde cursussen. Terugkerend: deelnemer in de selectie met actieve/afgeronde inschrijvingen voor meer dan één unieke editie in de volledige import. Deelnemers worden geïdentificeerd met Eduframe-ID's; namen, e-mailadressen en vrije tekst worden niet geïmporteerd.

Facturen worden via orders aan de cursussen gekoppeld. Multi-cursusorders kunnen bij meerdere selecties terugkomen; tel losse selecties niet op. Creditnota's en exacte boekingsregels moeten nog met echte SonoSkills-data worden gevalideerd. Er zijn nog geen jaarvergelijking, historische snapshots, AI-vragen, profielanalyses of Exact-data.

Draai deze versie met **één replica**: de synchronisatievergrendeling en loginpoginglimiet zijn proceslokaal. Gebruik Railway-back-ups voor PostgreSQL. Eduframe API documentatie: https://developer.eduframe.com/admin.html.

## Lokaal

Node.js 24 nodig. Zonder DATABASE_URL wordt uitsluitend buiten productie lokale SQLite gebruikt.

```sh
npm install
cp .env.example .env
# Vul loginvariabelen en SESSION_SECRET in; zet NODE_ENV=development in .env.
node --env-file=.env server.mjs
npm test
```

Open http://localhost:3000. Zet nooit secrets of productiedata in Git. Backendtests gebruiken gemockte Eduframe-responses; een echte synchronisatie vereist een token. PostgreSQL en Railway-deployment moeten in de doelomgeving worden gecontroleerd.
