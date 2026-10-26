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
- Werkruimtes op basis van Eduframe-categorieën: Hands-on; Online → eLearning, On-demand solo classes, Live solo classes; Producten; Extern. Het overzicht bevat eigen templates, zonder Extern.
- Categorieën (inclusief bovenliggende categorieën), templates en uitklapbare edities met eigen ID en Eduframe-variantnaam.
- Filters op categorie, template, locatie en periode. Hands-on/live/overzicht/extern: startdatum editie. eLearning/on-demand/producten: boekingsdatum order, met inschrijfdatum als terugval.
- Cursusedities, actieve/afgeronde inschrijvingen, gewogen bezetting en terugkerende deelnemers.
- Boekingsmaand via orderdatum, met inschrijfdatum als terugval.
- Gefactureerd en openstaand, apart per valuta. Geen optelling van verschillende valuta; conceptfacturen uitgesloten. Dit is geen boekhoudkundige omzetverantwoording of daadwerkelijke betalingsanalyse.
- Cursusoverzicht en CSV-export voor Excel.
- Eerste import bij start en automatische/handmatige synchronisatie, cursorpaginering, begrensde retries en rate limiting.
- Volledige snapshot wordt pas atomair vervangen als alle resources succesvol zijn opgehaald. Vorige data blijft bij fouten beschikbaar. Verwijderde records verdwijnen bij de volgende succesvolle import.

## Definities en grenzen

De periodefilter gebruikt bij Hands-on, Live solo classes, Extern en Overzicht de startdatum van de editie. eLearning, On-demand solo classes en Producten gebruiken de boekingsdatum. Templates zonder edities blijven zichtbaar. Categoriefilters omvatten ook subcategorieën. Na een import zijn de categorieën en editietypes beschikbaar; de categorie bepaalt de werkruimte. Inschrijvingen tellen alleen bij `active` en `completed`. Bezetting: som actieve/afgeronde inschrijvingen gedeeld door som bekende maximale capaciteiten, exclusief geannuleerde cursussen. Terugkerend: deelnemer in de selectie met actieve/afgeronde inschrijvingen voor meer dan één unieke editie in de volledige import. Deelnemers worden geïdentificeerd met Eduframe-ID's; namen, e-mailadressen en vrije tekst worden niet geïmporteerd.

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

## Royalties voor eLearning

De werkruimte Royalties beheert afspraken per template (alle edities/toegangsduurvarianten samen). Selecteer een template uit de categorie eLearning (inclusief ondercategorieën), een ontvanger, percentage (maximaal twee decimalen), ingangsdatum en optionele einddatum. Meerdere ontvangers zijn mogelijk. Afspraken voor dezelfde ontvanger en hetzelfde template mogen niet overlappen. De ingangsdatum wordt vergeleken met de betaaldatum.

**Extra Eduframe-scope:** `payments:read`. De synchronisatie vraagt betaalrecords op via `GET /invoices/{invoice_id}/payments` voor facturen van templates uit de eLearning-categorie. Dit kan de eerste import aanzienlijk verlengen. Alle verzoeken blijven read-only en volgen dezelfde rate limit. Als de betaalimport faalt, worden de overige dashboardgegevens bijgewerkt en de vorige betaalgegevens bewaard met een zichtbare foutstatus. Vaststellen is dan geblokkeerd.

De grondslag bestaat uitsluitend uit `paid`-betaalrecords, met hun geregistreerde `amount`, `currency` en `date`. Deelbetalingen vallen in hun eigen betaalperiode. De datum is de betaaldatum zoals Eduframe die levert; dit is geen onafhankelijke bankreconciliatie. Een terugbetaling corrigeert de grondslag alleen als deze in Eduframe als **negatieve betaalde betaling** is geregistreerd. Een creditnota of annulering zonder dergelijke betaling wordt niet automatisch als terugbetaling aangenomen. Controleer deze registratie bij de eerste echte afrekening.

Facturen worden via orders en inschrijvingen aan één template gekoppeld; er wordt niet op basis van aantallen deelnemers verdeeld. Orders met meerdere templates worden niet automatisch toegerekend en krijgen, wanneer ze een royaltytemplate bevatten, een blokkerende melding. Het overzicht meldt ook het aantal facturen zonder unieke templatekoppeling. Deze facturen zijn uitgesloten; controleer eventuele handmatige of afwijkende orderkoppelingen in Eduframe. Verschillende valuta blijven gescheiden.

Het conceptoverzicht is dynamisch en toont ontvangen, royalty, al vastgesteld en nog af te rekenen. Met begin/einddatum en één ontvanger kun je alle templates van die ontvanger vaststellen, ongeacht het templatefilter. De afrekening bevat de bronbetalingen, toenmalige namen en percentages, totalen en importsnapshotdatum. Dubbel afrekenen wordt voorkomen door per betaling/template/ontvanger/valuta/datum de al vastgestelde bedragen af te trekken. Latere wijzigingen leveren een correctie in de betreffende oorspronkelijke betaalperiode; open die periode opnieuw om deze af te rekenen. Vastgestelde afrekeningen worden niet herschreven. Afronding gebeurt op twee decimalen per template/ontvanger/valuta binnen de afrekening, na optelling van de ongeronde royaltybedragen.

Na vaststellen is een afspraak beschermd: alleen een einddatum die reeds afgerekende betalingen niet uitsluit kan worden aangepast. Voor een nieuw percentage sluit je de bestaande afspraak af en voeg je een nieuwe toe. Een ongebruikte afspraak kan worden bewerkt of verwijderd. Afrekeningen kunnen als betaald worden gemarkeerd met betaaldatum en referentie; dit voert **geen** bankbetaling uit. CSV-export is beschikbaar voor het overzicht en voor elke vastgestelde afrekening inclusief brondetails.

Afspraken en afrekeningen staan in een aparte `royalty_state`-tabel en worden niet overschreven door Eduframe-imports. Mutaties gebruiken een database-transactie en, in PostgreSQL, een rijvergrendeling om gelijktijdig dubbel vaststellen te voorkomen. Maak ook van deze tabel back-ups. Controleer de eerste echte berekening tegen Eduframe voordat je erop afrekent.


## Werkruimtes en categorieën

De categorie van het **template** bepaalt de werkruimte; `FixedPlannedCourse`/`FlexiblePlannedCourse` bepaalt dit niet meer. Hoofdcategorieën worden automatisch op naam herkend (niet gevoelig voor hoofdletters, spaties en koppeltekens). Onderliggende categorieën erven hun werkruimte. Hands-on en Live solo classes filteren op de startdatum van de editie; eLearning, On-demand solo classes en Producten filteren op boekingsdatum. De eigen overzichtspagina filtert op startdatum. Templates zonder enige editie blijven zichtbaar, ook onder Producten.

Onder Databronnen → Werkruimtes koppelen aan Eduframe-categorieën kun je voor elke werkruimte één of meerdere bestaande categorieën selecteren. De koppelingen gebruiken stabiele Eduframe-ID's en staan in de onafhankelijke tabel `workspace_config`. Met Automatische indeling herstellen worden de handmatige koppelingen verwijderd. Extern en Producten krijgen voorrang op een categorie met een andere werkruimtenaam binnen hun eigen subtree. Overige templates blijven vindbaar in het overzicht en de werkruimte Overige templates.

Externe cursussen tonen templates, edities, data, locaties en inschrijvingen. Hun financiële overzicht wordt verborgen en hun facturen tellen niet mee in het eigen overzicht. De toepassing blijft uitsluitend lezen uit Eduframe; planning en cursusgegevens worden niet teruggeschreven.

Royalties en de betalingsimport zijn beperkt tot templates die aan de eLearning-werkruimte zijn toegewezen. Na een gewijzigde indeling is opnieuw synchroniseren nodig voordat afrekeningen kunnen worden vastgesteld. Reeds vastgestelde afrekeningen blijven bewaard. De mapping, automatische categorieherkenning, uitsluiting van externe omzet en royaltyselectie zijn gedekt door tests.


## Pagina’s

Analysewerkruimtes hebben eigen routes: `/overview`, `/handson`, `/online/elearning`, `/online/on-demand`, `/online/live`, `/products`, `/external` en `/other`. De cursuslijst staat op `/courses`, royalties op `/royalties` en de koppelingen/instellingen op `/data-sources`. Alleen de gekozen pagina wordt getoond; de cursuslijst en databronnen staan niet meer onder elke analyse. Via Bekijk cursussen in deze selectie worden werkruimte en filters meegenomen naar de cursuspagina. Datum-, categorie-, template- en locatiefilters worden in de URL van analyse- en cursuspagina’s bewaard. Direct openen, verversen en browsernavigatie worden ondersteund. Oude hashlinks naar Cursussen en Databronnen worden omgezet naar de eigen route.
