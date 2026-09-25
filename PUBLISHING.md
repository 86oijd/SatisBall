# Auto-publishing to YouTube Shorts and TikTok

SatisBall can upload every export (and every video of a batch) by itself. Turn it on in **Export tab → YouTube Shorts / TikTok**. Both platforms need a one-time setup with your own developer credentials. Nothing is shared with anyone else: the studio talks to Google and TikTok directly (TikTok via your own relay).

> The studio must be opened from a web address (GitHub Pages, or `http://localhost:8000`), not by double-clicking `index.html`. Google and TikTok sign-in don't work on `file://` pages.

## YouTube Shorts (about 10 minutes)

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "SatisBall").
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External.
   - Add your own Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**.
   - Authorised JavaScript origins: your studio's address, e.g. `https://86oijd.github.io` and/or `http://localhost:8000`.
5. Copy the client ID (`….apps.googleusercontent.com`), paste it into **Export → YouTube Shorts**, and press **Connect YouTube**.
6. Switch on **Upload automatically**.
   - Optionally, **Schedule** (e.g. first video tomorrow 18:00, then one every 4 h). Scheduled videos upload as private and YouTube publishes them at their time.

Things to know:
- **Google's rule for new API projects:** videos uploaded through an *unaudited* project are locked to **private**.
  - Until then, set them public yourself in YouTube Studio (one click each).
  - To upload public videos automatically, submit the free **YouTube API Services audit** form for your project.
- **Quota:** the default is 10,000 units/day. One upload costs ~1,600, so about **6 uploads per day**. You can request more in the Cloud Console.
- **Shorts:** videos up to 3 minutes in 9:16 become Shorts automatically. The default title adds `#shorts`.
- **Sign-in:** a sign-in lasts about an hour. If it expires mid-batch, failed uploads show **↻** in the upload queue: reconnect, then retry.

## TikTok

TikTok's Content Posting API needs two things:
- a **registered TikTok developer app**
- a tiny **relay** server. It keeps the app's *client secret* off the web page, because a public page can't hide a secret.

**1. Create the app.** At <https://developers.tiktok.com/>:
   - Create an app and add **Login Kit** and **Content Posting API**.
   - Enable scopes `user.info.basic`, `video.upload` and `video.publish`.
   - Redirect URI: `https://<your-relay>/tiktok/callback`.
   - Submit it for review. TikTok needs to approve the app before real accounts can log in; while it's in sandbox, add your account as a test user.

**2. Deploy the relay** — see [`relay/README.md`](relay/README.md). It's free on Cloudflare Workers.

**3. Connect.** In **Export → TikTok**:
   - Paste the relay URL and press **Connect TikTok**. You'll log in on TikTok's own page.
   - Choose how to post:
     - **Send to TikTok inbox as a draft** (default): the video lands in your TikTok app's inbox and you tap post. This works without an audit and follows TikTok's rules for automation.
     - **Post directly**: posts straight to your profile. Until TikTok *audits* your app, direct posts can only be **Only me**. TikTok also requires you to pick the visibility yourself and agree to its Music Usage Confirmation. The studio asks for both.

## Captions

**Export → Titles, captions & hashtags** has templates for the YouTube title, the YouTube description and the TikTok caption. They can use these placeholders:
- `{hook}`: the hook text, without the `*stars*`
- `{winner}`: e.g. "MINT WINS!"
- `{mode}`, `{seed}`, `{secs}`
- `{hashtags}`
