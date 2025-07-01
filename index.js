require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const qs = require('querystring');

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  KAJABI_API_KEY,
  SITE_URL,
  DISCORD_INVITE_URL,
  PORT = 3000,
} = process.env;

const app = express();

// Step 1: Redirect Kajabi user to Discord OAuth2
app.get('/discord/oauth2', (req, res) => {
  const memberId = req.query.state;
  if (!memberId) {
    return res.status(400).send('Missing state (member ID)');
  }
  const redirectUri = encodeURIComponent(`http://localhost:3000/discord/callback`);
  console.log(`Redirecting member ${memberId} to Discord OAuth2`);
  console.log("Redirect URI:", redirectUri);
  const url = `https://discord.com/api/oauth2/authorize?` +
    `client_id=${DISCORD_CLIENT_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=identify%20guilds.join` +
    `&state=${memberId}`;
  res.redirect(url);
});

// Step 2: Handle OAuth2 callback, join guild, update Kajabi, and redirect
app.get('/discord/callback', async (req, res) => {
  try {
    const { code, state: memberId } = req.query;
    if (!code || !memberId) throw new Error('Missing code or state');

    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs.stringify({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${SITE_URL}/discord/callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('Invalid token response');

    // Fetch Discord user
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json();
    const discordId = userData.id;

    // Add user to guild
    await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      }
    );

    // Update Kajabi member via GraphQL
    await fetch('https://app.kajabi.com/api/v1/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KAJABI_API_KEY}`,
      },
      body: JSON.stringify({
        query: `
          mutation($id: ID!, $discordId: String!) {
            updateMember(input:{
              id: $id,
              customFields:{ discord_id: $discordId }
            }) { member { id } }
          }
        `,
        variables: { id: memberId, discordId },
      }),
    });

    // Redirect to server invite
    res.redirect(DISCORD_INVITE_URL);
  } catch (err) {
    console.error('OAuth flow error:', err);
    res.status(500).send(`Error during OAuth flow: ${err.message}`);
  }
});

// Start server
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
