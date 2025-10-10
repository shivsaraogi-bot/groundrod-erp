@echo off
echo ================================================
echo Ground Rod ERP - Deployment Script
echo ================================================
echo.

echo Step 1: Adding modified application files...
git add server.js
git add public/app.restored.js
git add public/index.html
git add public/test-client-po.html
echo ✅ Application files staged

echo.
echo Step 2: Adding documentation files...
git add ALL_FIXES_COMPLETE.md
git add CLIENT_PO_FIXES_COMPLETE.md
git add FIXES_SUMMARY.md
git add TESTING_GUIDE.md
git add DEPLOYMENT_CHECKLIST.md
git add DEPLOYMENT_GUIDE.md
git add .gitignore
echo ✅ Documentation files staged

echo.
echo Step 3: Removing unused app.js...
git rm -f public/app.js
echo ✅ Removed app.js

echo.
echo Step 4: Checking status...
git status

echo.
echo Step 5: Committing changes...
git commit -m "Fix Client PO list display, update raw materials, fix dashboard, remove unused app.js"

echo.
echo Step 6: Pushing to GitHub (this will trigger Render deployment)...
git push origin main

echo.
echo ================================================
echo ✅ Deployment Complete!
echo ================================================
echo.
echo Next steps:
echo 1. Go to your Render dashboard
echo 2. Wait 3-5 minutes for deployment to finish
echo 3. Open your app URL in INCOGNITO mode
echo 4. Hard refresh: Ctrl + F5
echo 5. Test creating a Client PO
echo.
echo Your Render app will automatically redeploy with these changes.
echo ================================================
pause
