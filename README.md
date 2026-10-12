# Snajper

3D multiplayer snajper igra u pregledniku. Svi otvore isti link i igraju, bez instalacije.

**Igra:** https://snajper.onrender.com

Servis je spojen na ovaj repozitorij preko javnog linka. Nakon promjene koda na Renderu klikni
**Manual Deploy → Deploy latest commit** (automatsko objavljivanje za javne linkove nije zajamčeno).

## Stavljanje na Render (jednom, ~10 minuta)

Render ne prima zip direktno, nego čita kod s GitHuba.

1. Na **github.com** napravi novi repozitorij, npr. `snajper` (može biti Private).
2. Na stranici repozitorija klikni **uploading an existing file** i povuci sve iz ove mape:
   `public`, `test`, `server.js`, `package.json`, `package-lock.json`, `render.yaml`, `README.md`, `.gitignore`.
   Mapu `node_modules` NE treba. Klikni **Commit changes**.
3. Na **render.com**: **New → Web Service** → poveži GitHub → odaberi `snajper`.
4. Postavke:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
5. **Deploy Web Service**. Za 2-3 minute dobiješ link oblika `https://snajper-xxxx.onrender.com`.

Kad promijeniš kod na GitHubu, Render sam napravi novu verziju.

## Prije sata

- Besplatni Render server **zaspi nakon 15 minuta bez igrača**. Prvo buđenje traje do minute.
  Otvori link 2 minute prije nego što krenete.
- **Testiraj u školi jednom prije nego što pozoveš razred.** Neke školske mreže blokiraju ovakve veze.
  Ako se ne možeš spojiti, nije do igre nego do mreže.
- Svi upisuju istu sobu (zadano `razred`). Gumb "Kopiraj link sobe" u pauzi daje link s već upisanom sobom.

## Igranje bez Rendera (isti Wi-Fi)

Na svom laptopu: `npm install` pa `npm start`. Ostali otvore `http://TVOJA-IP-ADRESA:3000`.
Najmanje kašnjenje, ali radi samo ako školska mreža dopušta da se računala vide međusobno.

## Kontrole

WASD kretanje · miš ciljanje · lijevi klik pucaj · desni klik (drži) nišan · kotačić zum 4x/8x (s nišanom),
inače mijenja oružje · Space skok · Shift trčanje (samo naprijed, ne s nišanom) · Ctrl ili C čučanj ·
Shift + Ctrl slajdanje (ako ga soba dopušta) · R punjenje · 1 puška · 2 ili Q banana-pištolj · Tab rezultati · Esc pauza

Igra pri ulasku prelazi na cijeli zaslon i zaključava tipkovnicu (Chrome i Edge), da Ctrl+W, Ctrl+R ili
Ctrl+broj ne zatvore karticu dok čučiš. Iz cijelog zaslona se izlazi držanjem tipke Esc. To se može ugasiti
u Postavkama (Cijeli zaslon u igri); tada čučni tipkom C. U Firefoxu zaključavanje ne radi, pa tamo koristi C.

## Pravila

- Svaki pogodak ubija, gdje god pogodi (glava, tijelo, noge). Headshot se samo posebno označi.
- Puška ima 5 metaka i repetira se 1.15 s između hitaca. Bez nišana metak ide jako široko.
- Nišan postaje precizan nakon 0.22 s. Kretanje i skakanje ga kvare, a čučanj ga popravlja.
- Kad netko nišani, vidi mu se odsjaj na glavi.
- 1.5 s nakon pojave te nitko ne može pogoditi (prekida se kad pucaš).
- Runda traje 5 minuta. Pobjeđuje tko ima najviše ubojstava.
- Ubojstvo puškom bez nišana svi vide kao NO-SCOPE (u popisu ubojstava, a žrtva vidi tko ju je no-scopeao).
- Slajdanje: u trku pritisni Ctrl ili C. Kratki nalet (do 10.5 m/s, oko 5 m), nisko kao u čučnju, pa 0.9 s pauze.
  Vlasnik sobe bira je li slajdanje dopušteno, a admin to može promijeniti usred igre.
- Za svaka 3 ubojstva zaredom (bez umiranja) dobiješ banana-pištolj s 8 eksplozivnih metaka (tipka 2 ili Q).
  Nema nišana, puca svakih 0.3 s. Izravan pogodak ubija, a metak eksplodira gdje udari i ubija sve
  u krugu od 3.5 m, osim ako ih štiti zid. Tebe ne ozljeđuje. Kad potrošiš metke, vraćaš se na pušku.
- Kad umreš, niz kreće od nule. Metci pištolja koje već imaš ostaju do kraja runde.

## Načini igre

Način bira onaj tko prvi otvori sobu (izbornik, **Način igre**). Izbornik pokazuje aktivne sobe:
ako upišeš sobu koja već igra, piše u kojem načinu ulaziš i tada se način ne bira. Na kraju svake runde
(15 s) igrači glasaju za sljedeći način tipkama 1, 2, 3 ili klikom. Pobjeđuje najviše glasova, kod
izjednačenja ostaje trenutni način (ako je među prvima), a bez glasova se igra isti način.
Admin može promijeniti način i usred igre.

- **Svi protiv svih**: svatko za sebe, pobjeđuje tko ima najviše ubojstava.
- **Timski deathmatch**: Crveni protiv Plavih. Ubojstvo protivnika je bod za tim, prvi do 30 pobjeđuje.
- **Zastava (CTF)**: zastave stoje kod tornjeva. Dodirni tuđu zastavu i odnesi je do svoje
  (tvoja mora biti u bazi). Ako nosač pogine, zastava pada; suigrač je vraća dodirom, a sama se vrati
  nakon 20 s. Prve 3 osvojene zastave pobjeđuju.

U timskim načinima nema pucanja po suigračima (ni eksplozijom). Timovi se sami izjednačavaju, botovi
ulaze u manji tim, a u pauzi se može **Promijeniti tim** ako to ne poremeti ravnotežu.

## Skinovi

Skin se bira u izborniku prije ulaska, uz mali 3D pregled. Ima ih šest: Klasik, Vozač, Robot, Kaktus,
Banana i Ninja. Dio svakog skina poprimi boju igrača.

Skinovi su samo izgled: svi imaju istu pogodnu zonu, pa nijedan nije lakše ni teže pogoditi.
Botovi dobiju nasumičan skin. Botovi su namjerno sporiji od dobrog igrača: primijete te tek nakon
0.45 do 0.75 s, prvi hitac ispale 1.4 do 2.6 s nakon toga i sporije se okreću.

## Grafika i rezolucija

Dvije odvojene postavke (u izborniku ili na Esc → Postavke):

- **Kvaliteta grafike** (mapa, skinovi, oružje): **Niska** je zadana i izgleda kao prvotna igra, za školska
  računala. **Visoka** dodaje teksture betona, kontejnera i trave, sjene, nebo s oblacima i detaljne
  modele puške i pištolja. **Ultra** dodaje oštrije teksture i sjene te travu po tlu. U izborniku se primijeni
  odmah, a u igri gumbom **Primijeni grafiku** (kratko ponovno spajanje u istu sobu).
- **Rezolucija**: od **Vrlo niske** do **Ultra** (dvostruka). Kreće na Niskoj (pola ekrana).
  Pored naziva piše stvarna rezolucija.

Gore desno piše FPS: ispod 30 se teško cilja, pa spusti rezoluciju ili grafiku. Koristite Chrome ili Edge.

Krv je zadano isključena (pogoci daju sive iskre). Uključuje se u Postavkama, stavka **Krv**.

## Admin panel

1. Na Renderu: **snajper → Environment → Add Environment Variable**,
   Key `ADMIN_KEY`, Value tvoja lozinka, pa **Save, rebuild, and deploy**.
   Lozinka se ne smije pisati u kod jer je repozitorij javan.
2. U igri pritisni **Esc** i na dnu klikni mali tekst **admin**, upiši lozinku.

Cheatovi (vrijede samo za tebe): besmrtnost, beskonačni meci, beskonačni banana-pištolj, brza paljba, savršen nišan,
brzina i skok, letenje kroz zidove (Space gore, Ctrl ili C dolje), vidi kroz zidove.
Soba: nova runda, završi rundu, način igre, broj botova, slajdanje uključeno/isključeno, poruka svima,
izbaci igrača. Timovi (TDM i CTF): prebaci bilo kojeg igrača u Crvene ili Plave, promiješaj timove,
zaključaj timove (tada se igrači ne mogu sami prebaciti).

Lozinka se pamti samo dok je kartica otvorena. Izbačeni igrač može ponovno ući.

## Za razvoj

`npm test` pokreće testove fizike i servera (pravi server, pravi klijenti: pogoci, ubojstva,
respawn, varanje, punjenje, runde, botovi, pištolj, admin, načini igre). `TEST_PORT_BASE=3201 npm test`
ako su zadani portovi zauzeti.

Grafika je u `public/gfx.js`, a modeli oružja u `public/viewmodel.js`.

Postavke igre su u `public/shared/config.js`, a mapa u `public/shared/map.js`.
