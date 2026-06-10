# indi-bridge-api
A small INDI bridge for web applications with WebSocket functionality.
This application assumes the implementation of an INDI environment.
Running this application will enable the following functions:

* Transfer INDI ports via WebSocket
* Read INDI driver XML files on the server
* Integrate with the distributed T-AstroWebStudio (driver startup from the application)

WebSocket is required to run INDI drivers from web applications or browsers.

Using the distributed T-AstroWebStudio, you can start drivers, configure settings, and control astronomical equipment from a web application.


##Installation method

mkdir -p ~/indi-bridge-api

cd ~/indi-bridge-api
npm init -y

npm install express ws cors

sudo npm install -g pm2

pm2 start index.js --name "indi-standalone-manager"

pm2 save

pm2 startup

