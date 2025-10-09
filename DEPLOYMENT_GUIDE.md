# Ground Rod ERP - Free Hosting Guide

## Option 1: Railway.app (RECOMMENDED - Easiest)

Railway is perfect for Node.js apps with SQLite databases.

### Prerequisites
- GitHub account
- Railway account (sign up at https://railway.app)

### Steps:

1. **Initialize Git Repository** (if not already done)
   ```bash
   cd c:\GroundRodERP
   git init
   git add .
   git commit -m "Initial commit - Ground Rod ERP"
   ```

2. **Create GitHub Repository**
   - Go to https://github.com/new
   - Create a new repository (e.g., "ground-rod-erp")
   - Don't initialize with README (we already have code)
   - Copy the repository URL

3. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/ground-rod-erp.git
   git branch -M main
   git push -u origin main
   ```

4. **Deploy to Railway**
   - Go to https://railway.app
   - Click "Start a New Project"
   - Select "Deploy from GitHub repo"
   - Choose your ground-rod-erp repository
   - Railway will automatically detect Node.js and deploy

5. **Configure Environment**
   - Railway auto-detects `npm start`
   - Your app will be available at a URL like: `https://ground-rod-erp-production.up.railway.app`

6. **Get Your Public URL**
   - Click on your deployment
   - Go to "Settings" → "Domains"
   - Railway provides a free domain like: `yourapp.up.railway.app`
   - You can also add a custom domain if you have one

### Important Notes:
- SQLite database will persist across deployments
- Free tier: 500 hours/month (~16 hours/day if always running)
- Auto-sleeps after inactivity, wakes up on first request

---

## Option 2: Render.com (Good Alternative)

Render offers free web services with automatic SSL.

### Steps:

1. **Same GitHub setup as Railway** (steps 1-3 above)

2. **Deploy to Render**
   - Go to https://render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - **Name**: ground-rod-erp
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Plan**: Free

3. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy
   - You'll get a URL like: `https://ground-rod-erp.onrender.com`

### Important Notes:
- Free tier spins down after 15 minutes of inactivity
- First request after sleep takes ~30 seconds to wake up
- SQLite database persists
- 750 hours/month free

---

## Option 3: Glitch.com (Instant, No Git Required)

Perfect for quick demos without Git/GitHub.

### Steps:

1. **Go to Glitch**
   - Visit https://glitch.com
   - Click "New Project" → "Import from GitHub" OR "hello-express"

2. **Upload Your Code**
   - If starting from hello-express:
     - Delete default files
     - Drag and drop your entire project folder
   - Or use the terminal in Glitch to clone your repo

3. **Configure**
   - Glitch auto-detects `package.json` and runs `npm start`
   - Your app is instantly live at: `https://your-project-name.glitch.me`

4. **Make Project Public**
   - Click "Share" → Set to "Public"
   - Anyone can access the URL

### Important Notes:
- Auto-sleeps after 5 minutes of inactivity
- Wakes up quickly (5-10 seconds)
- 4000 project hours/month (shared across all projects)
- Database resets every time project restarts (need to use external DB for persistence)

---

## Option 4: Vercel (Best for Static/Serverless)

**Note**: Vercel is optimized for serverless functions, not long-running Node.js servers. Your app needs modification.

### Skip this unless you want to refactor to serverless architecture.

---

## Option 5: Heroku (Used to be free, now paid)

Heroku discontinued free tier in November 2022. Minimum cost is $5/month.

---

## RECOMMENDED APPROACH FOR YOUR USE CASE

### Use Railway.app - Here's Why:

1. ✅ **Always-on option** (500 hrs/month = ~16 hrs/day)
2. ✅ **SQLite database persists** between deploys
3. ✅ **Automatic HTTPS** with custom domain support
4. ✅ **Fast deployment** from GitHub
5. ✅ **No cold starts** if you keep it running during work hours
6. ✅ **Easy environment variables** management
7. ✅ **Automatic deployments** on every Git push
8. ✅ **Free SSL certificate**

---

## Quick Start: Railway Deployment

### Step-by-Step Commands:

```bash
# 1. Navigate to your project
cd c:\GroundRodERP

# 2. Create .gitignore file (if not exists)
echo node_modules/ > .gitignore
echo .env >> .gitignore

# 3. Initialize Git
git init

# 4. Add all files
git add .

# 5. Commit
git commit -m "Initial commit - Ground Rod ERP system"

# 6. Create GitHub repo (do this manually on GitHub.com)
# Then run:
git remote add origin https://github.com/YOUR_USERNAME/ground-rod-erp.git
git branch -M main
git push -u origin main

# 7. Go to Railway.app
# - Sign up with GitHub
# - New Project → Deploy from GitHub Repo
# - Select ground-rod-erp
# - Wait for deployment
# - Get your public URL from Settings → Domains
```

### After Deployment:

Share this URL with your colleague:
```
https://ground-rod-erp-production.up.railway.app
```

They can access it from anywhere!

---

## Monitoring and Maintenance

### Railway Dashboard:
- **Deployments**: See build logs and deployment history
- **Metrics**: CPU, Memory, Network usage
- **Logs**: Real-time application logs
- **Environment Variables**: Set PORT, API keys, etc.

### Tips:
1. **Database Backups**: Download `erp_database.db` regularly from Railway
2. **Monitor Usage**: Check Railway dashboard to avoid hitting 500-hour limit
3. **Auto-Deploy**: Every `git push` to main branch triggers new deployment
4. **Rollback**: Easy rollback to previous deployments in Railway dashboard

---

## Troubleshooting

### Common Issues:

**Issue 1: Port Binding Error**
- Railway sets `PORT` environment variable automatically
- Your `server.js` should use: `process.env.PORT || 3000`

**Issue 2: Database Not Persisting**
- Ensure SQLite file path is relative: `./erp_database.db`
- Railway persists files in the project directory

**Issue 3: 500 Internal Server Error**
- Check Railway logs: Deployments → View Logs
- Common cause: Missing dependencies in `package.json`

**Issue 4: Site is Slow**
- Railway free tier may have some latency
- Consider upgrading to paid tier ($5/month) for better performance

---

## Cost Comparison (if you exceed free tier)

| Platform | Free Tier | Paid Tier |
|----------|-----------|-----------|
| Railway | 500 hrs/month | $5/month (unlimited) |
| Render | 750 hrs/month | $7/month (always-on) |
| Heroku | None | $5/month minimum |
| Vercel | Serverless free | $20/month (Pro) |

---

## Security Considerations

### Before Making Public:

1. **Add Authentication** (if handling sensitive data)
   - Consider adding login/password protection
   - Use environment variables for secrets

2. **HTTPS Only**
   - Railway/Render provide automatic HTTPS
   - Force HTTPS redirects in your code

3. **Rate Limiting**
   - Add rate limiting middleware to prevent abuse
   ```bash
   npm install express-rate-limit
   ```

4. **Environment Variables**
   - Never commit `.env` files to Git
   - Use Railway/Render dashboard to set secrets

5. **Database Backups**
   - Download database regularly
   - Consider using PostgreSQL for production (Railway offers free PostgreSQL)

---

## Next Steps After Deployment

1. ✅ Deploy to Railway
2. ✅ Share URL with colleague
3. ✅ Test all features remotely
4. ✅ Set up automatic backups
5. ✅ Monitor usage in Railway dashboard
6. ✅ Add authentication if needed
7. ✅ Consider upgrading to paid tier if heavily used

---

## Need Help?

- Railway Docs: https://docs.railway.app
- Render Docs: https://render.com/docs
- GitHub Help: https://docs.github.com

## Alternative: Local Network Access (No Internet Hosting)

If you just want your colleague to access it on the same network:

1. **Find your local IP address**
   ```bash
   ipconfig
   ```
   Look for "IPv4 Address" (e.g., 192.168.1.100)

2. **Update server.js to listen on all interfaces**
   ```javascript
   app.listen(3000, '0.0.0.0', () => {
     console.log('Server running on port 3000');
   });
   ```

3. **Share the URL with colleague**
   ```
   http://192.168.1.100:3000
   ```
   (They must be on the same WiFi/network)

4. **Configure Windows Firewall**
   - Allow inbound connections on port 3000
   - Or temporarily disable firewall for testing

---

**Recommendation**: Start with Railway.app for internet access, or use local IP if on same network.
