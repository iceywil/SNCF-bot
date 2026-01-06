# SNCF Bot

This is a Node.js script that automatically checks for SNCF train tickets, filters them based on your preferences, and sends you a notification on Telegram when a suitable offer is found.

## Setup

Before you can run the bot, you'll need to create and configure a few files.

### 1. Environment Variables (`.env`)

This file contains your secret keys. Create a file named `.env` in the root of the project and add the following content, replacing the placeholder with your actual Telegram bot key:

```
TELEGRAM_BOT_KEY=YOUR_TELEGRAM_BOT_KEY_HERE
TELEGRAM_CHAT_ID=
```

### 2. Headers (`headers.json`)

This file contains the request headers needed to successfully communicate with the SNCF API. Create a file named `headers.json`.

To get the content for this file:
1.  Go to the [SNCF Connect](https://www.sncf-connect.com/) website in your browser.
2.  Open your browser's developer tools (usually by pressing `F12`) and go to the "Network" tab.
3.  Perform a ticket search.
4.  Find a `POST` request to the `/bff/api/v1/itineraries` endpoint.
5.  Right-click on the request and copy all the request headers.
6.  Paste these headers into `headers.json` and then ask the AI to convert them to a valid JSON format.

**Note**: The cookie in the headers will expire periodically. If the script stops working, you'll likely need to repeat this step to get a fresh cookie.

### 3. Request Payload (`payload.json`)

This file contains the template for the request that will be sent to the SNCF API. Create a file named `payload.json`.

You can get the content for this file from the same network request you used for the headers. Find the "Payload" or "Request Body" section, copy the JSON object, and paste it into `payload.json`.

### 4. Bot Configuration (`config.txt`)

This file controls the bot's behavior. Create a file named `config.txt` and customize it to your needs. Here is an example:

```
seconds_between_each_request=10
seconds_between_each_batch=3600
dates_to_search=2025-12-26,2025-12-27,2025-12-28,2025-12-29
minimum_departure_time=08:00
train_type_direct_only=true
maximum_ticket_price=100
```

## Running the Bot

Once you have completed the setup, you can build and run the bot using Docker Compose. Make sure you have Docker installed and running on your machine.

Run the following command from the project's root directory:

```bash
docker-compose up --build -d
```

### Viewing Logs

To see what the bot is doing, you can view its logs with this command:

```bash
docker-compose logs -f
```

### Stopping the Bot

To stop the bot, run:

```bash
docker-compose down
```

