# Deployment Checklist

Use this checklist every time you deploy to Render.

## Before Committing

- [ ] Test changes locally at `http://localhost:3000`
- [ ] Verify in **incognito mode** (to avoid cache issues)
- [ ] Check which file `index.html` is loading (should be `app.restored.js`)
- [ ] Run: `git status` to see what changed

## Files to ALWAYS Commit

✅ **Application Code:**
- `server.js` (backend API)
- `public/app.restored.js` (main frontend app)
- `public/index.html` (HTML entry point)

✅ **Documentation:**
- `README.md`
- Any new `.md` files you created

✅ **Configuration:**
- `package.json` (if you added dependencies)

## Files to NEVER Commit

❌ **Do NOT commit:**
- `node_modules/` (dependencies - too large, Render installs them)
- `*.db` files (database - each environment has its own)
- `.claude/settings.local.json` (personal settings)
- `*.old.js`, `*.backup`, `*.bak` (backup files)

## Correct Git Workflow

```bash
# 1. Check what changed
git status

# 2. Add ONLY the files you want
git add server.js
git add public/app.restored.js
git add public/index.html
# Add any other specific files you changed

# 3. Commit with clear message
git commit -m "Brief description of what you changed"

# 4. Push to trigger Render deployment
git push origin main
```

## After Pushing to GitHub

1. **Go to Render Dashboard**
   - Watch the deployment progress
   - Wait for "Live" status (usually 2-5 minutes)

2. **Test the Deployed App**
   - Open Render URL in **incognito mode**
   - Hard refresh: `Ctrl + F5`
   - Test the features you changed

3. **If Something Doesn't Work**
   - Check Render logs for errors
   - Verify correct files were committed
   - Make sure `.gitignore` didn't exclude needed files

## Common Mistakes to Avoid

❌ **Mistake 1: Committing node_modules**
```bash
# WRONG - Don't do this!
git add .
git commit -m "changes"
```
This adds EVERYTHING including node_modules (100+ MB!).

✅ **Correct Way:**
```bash
# RIGHT - Be specific
git add server.js public/app.restored.js
git commit -m "Fix client PO list"
```

❌ **Mistake 2: Committing Database**
Database files (`.db`) should stay local. Render creates its own database.

❌ **Mistake 3: Not Testing in Incognito**
Always test in incognito mode after deployment to avoid browser cache.

❌ **Mistake 4: Having Multiple App Files**
Only have ONE main app file: `app.restored.js`
Delete or rename old versions like `app.js`

## File Structure Reference

```
c:\GroundRodERP\
├── server.js                    ✅ Commit (backend)
├── package.json                 ✅ Commit (dependencies list)
├── package-lock.json           ✅ Commit (exact versions)
├── .gitignore                  ✅ Commit (tells git what to ignore)
├── README.md                   ✅ Commit (documentation)
│
├── public/
│   ├── index.html              ✅ Commit (HTML entry)
│   ├── app.restored.js         ✅ Commit (MAIN frontend app)
│   ├── app.js                  ❌ DELETE or rename to .old.js
│   └── test-client-po.html     ✅ Commit (testing page)
│
├── node_modules/               ❌ NEVER COMMIT (too large)
├── *.db                        ❌ NEVER COMMIT (local database)
└── .claude/                    ❌ NEVER COMMIT (personal settings)
```

## Quick Reference: What to Commit

| File/Folder | Commit? | Why |
|-------------|---------|-----|
| `server.js` | ✅ YES | Backend code |
| `public/app.restored.js` | ✅ YES | Frontend app |
| `public/index.html` | ✅ YES | HTML entry |
| `package.json` | ✅ YES | Dependencies |
| `README.md` | ✅ YES | Documentation |
| `node_modules/` | ❌ NO | Render installs this |
| `*.db` | ❌ NO | Local database |
| `.claude/` | ❌ NO | Personal settings |
| `app.js` (old) | ❌ NO | Delete or rename |

## Verify Deployment

After deploying, verify these URLs work:

1. **Homepage**: `https://your-app.onrender.com`
2. **API Health**: `https://your-app.onrender.com/api/products`
3. **Client PO**: Navigate to Client PO tab, create a test PO

## Rollback if Needed

If deployment breaks something:

```bash
# See recent commits
git log --oneline -5

# Revert to previous commit
git revert HEAD

# Push the revert
git push origin main
```

Render will automatically deploy the reverted version.

## Best Practices

1. **Test Locally First**: Always test at `http://localhost:3000` before deploying
2. **Use Incognito**: Test in incognito mode to avoid cache issues
3. **Small Commits**: Commit small, logical changes (easier to debug)
4. **Clear Messages**: Use descriptive commit messages
5. **Check Render Logs**: Always check Render deployment logs after pushing
6. **One Main File**: Keep only `app.restored.js`, delete old versions

## Environment Differences

| Environment | URL | Database | Node Modules |
|-------------|-----|----------|--------------|
| **Local** | `localhost:3000` | `groundrod.db` | Local install |
| **Render** | `your-app.onrender.com` | Render's DB | Render installs |

Each environment has its own database - they don't sync automatically.

## Need Help?

If deployment fails:
1. Check Render logs in dashboard
2. Verify `.gitignore` is correct
3. Make sure you didn't commit `node_modules/`
4. Test locally first in incognito mode
5. Check that `index.html` loads the correct JS file
