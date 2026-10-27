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

Elke werkruimte toont de eigen analyses én cursuslijst op de eigen route: `/overview`, `/handson`, `/online/elearning`, `/online/on-demand`, `/online/live`, `/products`, `/external` en `/other`. Filters, sortering, uitklapbare edities en CSV-export werken op die pagina. Er is geen aparte pagina Cursussen meer. Oude `/courses`-links worden doorgestuurd naar de bijbehorende werkruimte met behoud van queryfilters. Royalties staat op `/royalties`; Databronnen en categorie-instellingen staan op `/data-sources`.


## Orders en bevestiging

Verkoopanalyses en meest/minst verkocht zijn gebaseerd op unieke orders met status `active` of `requested`. `canceled` en `denied` tellen niet mee. De import haalt catalogusvarianten via `/catalog/variants` op en koppelt orders via `catalog_variant_id` aan een editie, ook als er nog geen inschrijving is. De oude `planned_course_id` en inschrijvingskoppelingen worden eveneens meegenomen. Bij tegenstrijdige/meerdere editiekoppelingen wordt de order niet geschat verdeeld; het dashboard toont een melding.

Een inschrijving is binnen de SonoSkills-workflow het bevestigingssignaal dat een cursus doorgaat. Het dashboard telt actieve/afgeronde inschrijvingen daarom apart als bewijs van bevestiging en telt ze niet boven op orders als verkoop. Een niet-geannuleerde editie met minimaal één actieve/afgeronde inschrijving krijgt het label Bevestigd. Zonder dit signaal staat er Nog niet bevestigd; de cursusstatus uit Eduframe blijft daarnaast zichtbaar.

Geboekte plaatsen komt uit `number_of_students`, met het aantal order-items als terugval wanneer dit aantal ontbreekt. Eén order kan meerdere plaatsen boeken. Ontbrekende aantallen worden niet als één deelnemer verondersteld; de bezetting blijft dan onbekend. Boekingsbezetting is geboekte plaatsen / bekende capaciteit van niet-geannuleerde vaste edities. Het maanddiagram telt orders op boekingsdatum. Hands-on en Live blijven op cursusdatum gefilterd; online verkoop op boekingsdatum.

Het financiële hoofdscherm toont alleen Totale omzet (de som van definitieve facturen na creditnota’s) en Openstaand (het nog te betalen deel van dezelfde facturen). Openstaand is onderdeel van Totale omzet en wordt daar niet bovenop geteld. Orderwaarde is niet langer een financiële indicator in het hoofdscherm. Royalties blijven uitsluitend op betaalde betaalrecords gebaseerd. Na deze update is een synchronisatie nodig voor catalogusvariantkoppelingen en aantallen per order.


## Financieel overzicht en factuurkoppelingen

Totale omzet wordt uitsluitend opgebouwd uit facturen; conceptfacturen tellen niet mee. Negatieve facturen/creditnota’s verlagen de omzet. Het openstaande bedrag is het saldo van diezelfde facturen. Het dashboard toont geen aparte orderwaarde of ontvangen bedrag in het hoofdscherm.

Facturen worden via hun order gekoppeld aan de editie, of rechtstreeks via `invoice_items.catalog_variant_id`. Zo kunnen handmatige facturen zonder orderkoppeling worden meegenomen als de factuurregel een herkenbare cursusvariant bevat. Bij meerdere edities moet de volledige factuur binnen de selectie passen; er wordt niet naar rato geschat verdeeld. Een factuur wordt maximaal één keer geteld. Externe cursussen blijven uitgesloten.

Ontbrekende, onvolledige en deels buiten de selectie vallende factuurkoppelingen worden in een uitklapbaar overzicht vermeld met factuurnummer, factuurdatum, bedrag, openstaand bedrag en reden. Ze tellen niet mee in de getoonde omzet. De lijst met niet toegerekende facturen gebruikt de gekozen periode op factuurdatum, omdat de cursusdatum niet altijd vast te stellen is. Voor een online handmatige factuur zonder order wordt de factuurdatum gebruikt als boekingsdatum. De nieuwe factuurregelreferenties komen beschikbaar na synchronisatie.


## Omzetcontrole per selectie

Onder Financieel overzicht → Omzet onderbouwen staat per factuur of deze meetelt, plus het factuurbedrag, openstaand, orderreferentie en uitsluitingsreden. Dezelfde controle bevat de bijbehorende orders ter vergelijking; orderbedragen worden niet bij de omzet opgeteld. Met Omzetcontrole downloaden exporteer je deze onderbouwing inclusief filterinstellingen en synchronisatiedatum. De export is alleen na login beschikbaar via `/api/finance-export`.

Bij een factuur die de geselecteerde editie raakt, blijven uitsluitingen zichtbaar ook wanneer de factuurdatum buiten de cursusperiode ligt. Volledig niet gekoppelde facturen worden uitsluitend binnen de gekozen factuurperiode als mogelijke ontbrekende koppelingen getoond; deze kunnen ook andere cursussen betreffen. De controle verandert de omzetdefinitie of toerekening niet. Nieuwe imports bewaren daarnaast de aantallen en stuksprijzen bij factuurregelreferenties, zodat verschillen met Eduframe kunnen worden nagelopen.

### MailerLite nieuwsbrief

Stel `MAILERLITE_API_TOKEN` in bij de Railway-service. Gebruik een token van de huidige MailerLite API (`connect.mailerlite.com`), via Integrations → MailerLite API → Generate new token. Na deployment start de import automatisch; handmatig verversen kan onder Databronnen → MailerLite. De import draait ook met de bestaande synchronisatie-interval, onafhankelijk van Eduframe.

De koppeling haalt vijf telresultaten op met `limit=0`, één per contactstatus, plus de groepslijst via GET `/groups` (met paginering). De groepslijst bevat namen en geaggregeerde aantallen per contactstatus. Contacten kunnen in meerdere groepen voorkomen; groepsaantallen worden niet opgeteld bij het unieke accounttotaal. Er worden geen contacten, namen, e-mailadressen of aanmaakdatums opgehaald. Alleen aantallen en dagelijkse metingen worden bewaard. Bij fouten blijven de laatst geslaagde metingen intact.

De groeigrafiek toont gemeten actieve abonnees vanaf de koppeling. Bij één meetdag is netto groei nog onbekend; eerdere aanwas wordt niet gereconstrueerd. De actuele aantallen zijn onafhankelijk van de dashboardperiode; de groeigrafiek volgt de gekozen periode. De totale sync heeft een tijdslimiet van twee minuten, met aparte request timeouts en begrensde retries.

### Facebook & Instagram

Stel `META_ACCESS_TOKEN` (verlengd User-token), `META_FACEBOOK_PAGE_ID` en `META_INSTAGRAM_ACCOUNT_ID` in Railway in. Graph API v26.0 wordt gebruikt. De eigen accounts kunnen in Development Mode worden getest met een appbeheerder die de benodigde accountrechten en leesrechten heeft. Gebruik `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic` en `instagram_manage_insights`. Tokens blijven uitsluitend server-side. Voor Facebook-posts wordt indien mogelijk tijdelijk een Page-token afgeleid; dit wordt nooit opgeslagen of teruggestuurd. Een verlopen token geeft een melding en moet vernieuwd worden in Railway.

Social media heeft een eigen pagina `/social`, eigen permanente opslag en een onafhankelijke synchronisatie bij opstart en volgens `SYNC_INTERVAL_MINUTES`. Volgers worden dagelijks gemeten; bestaande dagmetingen worden bijgewerkt. Geen historische groei wordt verzonnen. Posts worden op publicatiedatum in Europe/Amsterdam gefilterd. Interacties zijn de actuele cumulatieve aantallen op de posts uit die periode, niet een telling van de interactiedatum. Facebook toont reacties, comments en shares; Instagram toont likes en comments. Instagram-shares, saves, bereik en impressions zijn nog niet aangesloten. Ontbrekende waarden worden als onbekend getoond. De import pagineert de eigen post/media-metadata, met een plafond van 100 pagina’s en drie minuten. Onvolledige imports vervangen geen eerder geslaagde postgegevens. Profielgegevens kunnen onafhankelijk daarvan wel vernieuwd worden. LinkedIn is nog niet gekoppeld.
