@echo off
title Equra AI PDF Automator

echo =======================================================
echo    Equra AI: Financial Reports Downloader Assistant
echo =======================================================
echo.
echo I will now open the 20 EGX company IR pages in your browser.
echo Please save the PDF reports (last 8 quarters) to the folders.
echo.
pause

:: Create the folders
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\ETEL" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\COMI" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\SWDY" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\TMGH" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\FWRY" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\HRHO" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\PHDC" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\ABUK" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\EAST" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\JUFO" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\HDBK" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\VALU" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\MFPC" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\EGAL" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\ESRS" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\EFID" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\CIRA" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\CLHO" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\ORWE" 2>nul
mkdir "c:\Repos\equra-ai-backend\server\financial-reports\SKPC" 2>nul

echo Folders created in c:\Repos\equra-ai-backend\server\financial-reports\
echo.

echo 1. Opening Telecom Egypt (ETEL)...
start "ETEL" "https://ir.te.eg/en/FinancialInformation/QuarterlyResults"
pause

echo 2. Opening CIB (COMI)...
start "COMI" "https://www.cibeg.com/en/investor-relations/quarterly-results"
pause

echo 3. Opening El Sewedy Electric (SWDY)...
start "SWDY" "https://ir.elsewedyelectric.com/en/results-center"
pause

echo 4. Opening Talaat Moustafa Group (TMGH)...
start "TMGH" "https://ir.tmg-heliopolis.com/"
pause

echo 5. Opening Fawry (FWRY)...
start "FWRY" "https://english.mubasher.info/markets/EGX/stocks/FWRY/financial-statements"
pause

echo 6. Opening EFG Hermes (HRHO)...
start "HRHO" "https://www.efghermes.com/en/investor-center/financial-results"
pause

echo 7. Opening Palm Hills (PHDC)...
start "PHDC" "https://english.mubasher.info/markets/EGX/stocks/PHDC/financial-statements"
pause

echo 8. Opening Abu Qir Fertilizers (ABUK)...
start "ABUK" "https://english.mubasher.info/markets/EGX/stocks/ABUK/financial-statements"
pause

echo 9. Opening Eastern Company (EAST)...
start "EAST" "https://english.mubasher.info/markets/EGX/stocks/EAST/financial-statements"
pause

echo 10. Opening Juhayna Food Industries (JUFO)...
start "JUFO" "https://english.mubasher.info/markets/EGX/stocks/JUFO/financial-statements"
pause

echo 11. Opening Housing & Development Bank (HDBK)...
start "HDBK" "https://english.mubasher.info/markets/EGX/stocks/HDBK/financial-statements"
pause

echo 12. Opening U Consumer Finance (VALU)...
start "VALU" "https://english.mubasher.info/markets/EGX/stocks/VALU/financial-statements"
pause

echo 13. Opening Misr Fertilizers Production Company (MFPC)...
start "MFPC" "https://english.mubasher.info/markets/EGX/stocks/MFPC/financial-statements"
pause

echo 14. Opening Egypt Aluminum (EGAL)...
start "EGAL" "https://english.mubasher.info/markets/EGX/stocks/EGAL/financial-statements"
pause

echo 15. Opening Ezz Steel (ESRS)...
start "ESRS" "https://english.mubasher.info/markets/EGX/stocks/ESRS/financial-statements"
pause

echo 16. Opening Edita Food Industries (EFID)...
start "EFID" "https://english.mubasher.info/markets/EGX/stocks/EFID/financial-statements"
pause

echo 17. Opening Cairo for Investment (CIRA)...
start "CIRA" "https://english.mubasher.info/markets/EGX/stocks/CIRA/financial-statements"
pause

echo 18. Opening Cleopatra Hospital (CLHO)...
start "CLHO" "https://english.mubasher.info/markets/EGX/stocks/CLHO/financial-statements"
pause

echo 19. Opening Oriental Weavers (ORWE)...
start "ORWE" "https://english.mubasher.info/markets/EGX/stocks/ORWE/financial-statements"
pause

echo 20. Opening Sidi Kerir Petrochemicals (SKPC)...
start "SKPC" "https://english.mubasher.info/markets/EGX/stocks/SKPC/financial-statements"
echo.
echo All 20 URLs opened!
echo.
echo Once you've downloaded all PDFs to the folders, you can close this window.
pause