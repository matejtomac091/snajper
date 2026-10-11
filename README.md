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
inače mijenja oružje · Space skok · Shift ili C čučanj · R punjenje · 1 puška · 2 ili Q eksplozivni pištolj ·
Tab rezultati · Esc pauza

## Pravila

- Svaki pogodak ubija, gdje god pogodi (glava, tijelo, noge). Headshot se samo posebno označi.
- Puška ima 5 metaka i repetira se 1.15 s između hitaca. Bez nišana metak ide jako široko.
- Nišan postaje precizan nakon 0.22 s. Kretanje i skakanje ga kvare, a čučanj ga popravlja.
- Kad netko nišani, vidi mu se odsjaj na glavi.
- 1.5 s nakon pojave te nitko ne može pogoditi (prekida se kad pucaš).
- Runda traje 5 minuta. Pobjeđuje tko ima najviše ubojstava.
- Za svaka 3 ubojstva zaredom (bez umiranja) dobiješ eksplozivni pištolj s 8 metaka (tipka 2 ili Q).
  Nema nišana, puca svakih 0.3 s. Izravan pogodak ubija, a metak eksplodira gdje udari i ubija sve
  u krugu od 3.5 m, osim ako ih štiti zid. Tebe ne ozljeđuje. Kad potrošiš metke, vraćaš se na pušku.
- Kad umreš, niz kreće od nule. Metci pištolja koje već imaš ostaju do kraja runde.

## Skinovi

Skin se bira u izborniku prije ulaska, uz mali 3D pregled. Ima ih šest: Klasik, Vozač, Robot, Kaktus,
Banana i Ninja. Dio svakog skina poprimi boju igrača.

Skinovi su samo izgled: svi imaju istu pogodnu zonu, pa nijedan nije lakše ni teže pogoditi.
Botovi dobiju nasumičan skin.

## Rezolucija

Igra kreće na **Niskoj** rezoluciji (pola ekrana) da radi i na slabim računalima.
U Postavkama (u izborniku ili na Esc) može se birati od **Vrlo niske** do **Ultra** (dvostruka rezolucija,
samo za jaka računala). Pored naziva piše stvarna rezolucija. Gore desno piše FPS: ispod 30 se teško cilja.
Koristite Chrome ili Edge.

Krv je zadano isključena (pogoci daju sive iskre). Uključuje se u Postavkama, stavka **Krv**.

## Admin panel

1. Na Renderu: **snajper → Environment → Add Environment Variable**,
   Key `ADMIN_KEY`, Value tvoja lozinka, pa **Save, rebuild, and deploy**.
   Lozinka se ne smije pisati u kod jer je repozitorij javan.
2. U igri pritisni **Esc** i na dnu klikni mali tekst **admin**, upiši lozinku.

Cheatovi (vrijede samo za tebe): besmrtnost, beskonačni meci, beskonačni eksplozivni pištolj, brza paljba, savršen nišan,
brzina i skok, letenje kroz zidove (Space gore, Shift dolje), vidi kroz zidove.
Soba: nova runda, završi rundu, broj botova, poruka svima, izbaci igrača.

Lozinka se pamti samo dok je kartica otvorena. Izbačeni igrač može ponovno ući.

## Za razvoj

`npm test` pokreće testove fizike i servera (pravi server, pravi klijenti: pogoci, ubojstva,
respawn, varanje, punjenje, runde, botovi).

Postavke igre su u `public/shared/config.js`, a mapa u `public/shared/map.js`.
