require("dotenv").config();
const express = require("express");
const axios   = require("axios");
const qs      = require("qs");

const app = express();
const port = process.env.PORT || 3000;

// Step 1: Redirect users here to start OAuth
app.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope:         "identify guilds.join",
    state:         req.query.memberId  // you can pass memberId from Kajabi here
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

// Step 2: Discord redirects back here with `?code=…&state=…`
app.get("/", async (req, res) => {
  const { code, state: memberId } = req.query;
  if (!code || !memberId) {
    return res.status(400).send("Missing code or state");
  }

  try {
    // 1️⃣ Exchange code for Access Token
    const tokenResp = await axios.post(
      "https://discord.com/api/oauth2/token",
      qs.stringify({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const accessToken = tokenResp.data.access_token;

    // 2️⃣ Fetch Discord user
    const userResp = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const discordId = userResp.data.id;
    console.log("Discord User ID:", discordId);

    // 3️⃣ Add to guild
    await axios.put(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
      { access_token: accessToken },
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    console.log("Added to Discord guild");

    // 4️⃣ Update Kajabi
    await axios.post(
      process.env.KAJABI_GRAPHQL_URL,
      {
        query: `
          mutation($id: ID!, $discordId: String!) {
            updateMember(input:{
              id: $id,
              customFields:{ discord_id: $discordId }
            }) { member { id } }
          }
        `,
        variables: { id: memberId, discordId }
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${process.env.KAJABI_API_KEY}`
        }
      }
    );
    console.log("Updated Kajabi member with Discord ID");

    // 5️⃣ Redirect into your Discord invite
    res.redirect(process.env.DISCORD_INVITE_URL);
  }
  catch (err) {
    console.error("OAuth flow error:", err.response?.data || err.message);
    res.status(500).send("Internal error during OAuth flow");
  }
});

// Health check
app.get("/health", (req, res) => res.send("OK"));

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
