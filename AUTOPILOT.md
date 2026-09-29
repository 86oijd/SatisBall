# Autopilot: a laptop that makes and posts videos 24/7

Every few hours (default: every 2 h) the autopilot:

1. **Searches.** It runs the seed finder over *all* your chosen modes: 5,000 seeds in total by default, split evenly (about 263 per mode with all 19 modes on).
   - Settings can be varied too, so it explores different setups as well as different seeds.
   - A time limit stops it early on a slow machine.
2. **Picks** the most entertaining run of the search, compared fairly across modes. The score mixes the run's raw score with how exceptional it is *for its mode*.
   - Runs outside your length window, or already posted, are ignored.
   - It avoids posting the same mode twice in a row.
3. **Renders** it at your Export settings (1080×1920, 60 fps by default), with a random palette and sound if you like.
4. **Uploads** it to YouTube and/or TikTok, using your caption templates and within your daily caps.
5. **Logs** the post and sleeps until the next slot.

Everything is saved in the browser: the schedule, the log, and which runs were already posted. Closing the window, a crash or a reboot is safe — it continues from where it was.

**How long a search takes:** measured at ~0.4 s per seed, so 5,000 seeds ≈ 30 minutes on a normal PC. On a weak laptop expect 45–90 min. Rendering the video then takes a few minutes.

## Set up once

1. **Host the studio** (GitHub Pages, see README). Autopilot needs a real web address for sign-ins.
2. **Deploy the relay** (`relay/README.md`) with **both** the TikTok and the Google variables.
   - The Google part gives the autopilot a *refresh token*, so YouTube uploads keep working for months without signing in again. A normal browser sign-in only lasts an hour.
3. Edit the `URL` line at the top of **`Start Autopilot.bat`** to your studio's address, then double-click it.
   - It opens a dedicated browser window (its own profile) with background throttling turned off, and stops Windows from sleeping on mains power.
4. **In that window** go to the Export tab:
   - **YouTube Shorts:** paste the client ID, then press **Connect via relay (stays signed in)**.
   - **TikTok:** paste the relay URL, then press **Connect TikTok**.
   - **Autopilot:** check the settings and press **Start autopilot**.
5. Optional: run **`Install Autopilot Autostart.bat`** so it starts every time you log in.

### Google setup for refresh tokens
Use the same Google Cloud project as in PUBLISHING.md. In your OAuth client (Web application):
- add `https://<your-relay>/google/callback` under **Authorised redirect URIs**
- copy the **client secret** into the relay's `GOOGLE_CLIENT_SECRET`

**Important:** on the OAuth consent screen, press **Publish app** (switch "Testing" to "In production").
- In Testing mode Google expires refresh tokens after **7 days**, which would stop the autopilot every week.
- For your own account the app doesn't need Google's verification. You'll just click through an "unverified app" warning once.

## Leave it running

- **Power:** keep it plugged in. The launcher disables sleep on mains power; the screen turning off is fine.
- **Updates:** Windows updates can reboot the machine. With the autostart installed and automatic sign-in, it comes back by itself.
- **Leave the window alone:** minimising is OK, but don't close it. The dashboard shows the current step, the best runs found, the countdown and every post.

## Limits you can't switch off

- **YouTube:**
  - The default API quota is ~6 uploads a day, so leave the "YouTube uploads per day" cap at 6 unless Google raises your quota.
  - Until your API project passes Google's audit, uploads are **private**.
  - With a 2-hour cycle that's up to 12 videos a day. Cycles beyond a platform's cap skip that platform, and a cycle is skipped entirely when every connected platform is full.
- **TikTok:**
  - **Inbox drafts** (the default) need you to tap post in the TikTok app, and TikTok allows only ~5 pending drafts a day.
  - **Direct posts** need an app audited by TikTok. Until then they're "Only me".
- **Laptop speed:** if a search runs past its time limit, it stops early with whatever it found. If a whole cycle takes longer than the interval, the next one starts right after.
