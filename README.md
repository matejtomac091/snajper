# Snajper

3D multiplayer snajper igra u pregledniku. Svi otvore isti link i igraju, bez instalacije.

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

WASD kretanje · miš ciljanje · lijevi klik pucaj · desni klik (drži) nišan · kotačić zum 4x/8x ·
Space skok · Shift ili C čučanj · R punjenje · Tab rezultati · Esc pauza

## Pravila

- Glava ubija iz jednog metka (100), tijelo 60, noge 40. Svatko ima 100 života.
- Puška ima 5 metaka i repetira se 1.15 s između hitaca. Bez nišana metak ide jako široko.
- Nišan postaje precizan nakon 0.22 s. Kretanje i skakanje ga kvare, a čučanj ga popravlja.
- Kad netko nišani, vidi mu se odsjaj na glavi.
- 1.5 s nakon pojave te nitko ne može pogoditi (prekida se kad pucaš).
- Runda traje 5 minuta. Pobjeđuje tko ima najviše ubojstava.

## Slaba računala

U postavkama stavi **Kvaliteta slike: Niska**. Gore desno piše FPS: ispod 30 se teško cilja.
Koristite Chrome ili Edge, ne Internet Explorer.

## Za razvoj

`npm test` pokreće testove fizike i servera (pravi server, pravi klijenti: pogoci, ubojstva,
respawn, varanje, punjenje, runde, botovi).

Postavke igre su u `public/shared/config.js`, a mapa u `public/shared/map.js`.
