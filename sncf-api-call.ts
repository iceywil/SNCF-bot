import * as fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';

dotenv.config();

// --- Telegram Setup ---
const token = process.env.TELEGRAM_BOT_KEY;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
    console.error('Telegram bot token or chat ID is not defined in .env file');
    process.exit(1);
}
const bot = new TelegramBot(token);

async function sendTelegramMessage(message: string) {
    try {
        await bot.sendMessage(chatId!, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error sending message to Telegram:', error);
    }
}

// --- Interfaces ---
interface Offer {
    id: string;
    comfortClass: { label: string };
    priceLabel: string;
    title: string;
}

interface Proposal {
    id: string;
    travelId: string;
    departure: {
        originStationLabel: string;
        timeLabel: string;
        dateLabel: string;
    };
    arrival: {
        destinationStationLabel: string;
        timeLabel: string;
        dateLabel: string;
    };
    durationLabel: string;
    transporterDescription: string;
    firstComfortClassOffers?: { offers: Offer[] };
    secondComfortClassOffers?: { offers: Offer[] };
}

interface AppConfig {
    secondsBetweenEachRequest: number;
    secondsBetweenEachBatch: number;
    datesToSearch: string[];
    minimumDepartureTime: string;
    trainTypeDirectOnly: boolean;
    maximumTicketPrice: number;
}

interface ItineraryResponse {
    itineraryId?: string;
    longDistance?: {
        itineraryId?: string;
        proposals: {
            proposals: Proposal[];
        }
    };
    proposals?: Proposal[];
}

function processProposals(itineraryName: string, proposals: Proposal[], config: AppConfig) {
    if (!cachedProposals.has(itineraryName)) {
        cachedProposals.set(itineraryName, new Map());
    }
    const itineraryCache = cachedProposals.get(itineraryName)!;
    const newProposalsForCache: Map<string, Proposal> = new Map();

    for (const proposal of proposals) {
        if (config.trainTypeDirectOnly && !proposal.transporterDescription.toLowerCase().includes('direct')) continue;
        if (proposal.departure.timeLabel < config.minimumDepartureTime) continue;

        const allOffers: Offer[] = [
            ...(proposal.firstComfortClassOffers?.offers || []),
            ...(proposal.secondComfortClassOffers?.offers || [])
        ];
        
        const filteredOffers = allOffers.filter(offer => {
            const price = parseFloat(offer.priceLabel.replace(/[^0-9,]/g, '').replace(',', '.'));
            return price <= config.maximumTicketPrice;
        });

        if (filteredOffers.length === 0) continue;

        newProposalsForCache.set(proposal.travelId, { ...proposal });
        const cachedProposal = itineraryCache.get(proposal.travelId);

        if (!cachedProposal) {
            logNewOffers(itineraryName, proposal, filteredOffers);
        } else {
            const getStableOfferId = (o: Offer) => `${o.priceLabel}-${o.title}`;
            const cachedOfferIds = new Set([
                ...(cachedProposal.firstComfortClassOffers?.offers || []),
                ...(cachedProposal.secondComfortClassOffers?.offers || [])
            ].map(getStableOfferId));
            
            const newlyAppearedOffers = filteredOffers.filter(o => !cachedOfferIds.has(getStableOfferId(o)));

            if (newlyAppearedOffers.length > 0) {
                logNewOffers(itineraryName, proposal, newlyAppearedOffers, true);
            }
        }
    }
    cachedProposals.set(itineraryName, newProposalsForCache);
}


// --- Caching ---
let cachedProposals: Map<string, Map<string, Proposal>> = new Map();

// --- Configuration Parsing ---
function parseConfig(): AppConfig {
    const configContent = fs.readFileSync('config.txt', 'utf-8');
    const configLines = configContent.split('\n');
    const config: any = {};
    for (const line of configLines) {
        const parts = line.split('=');
        if (parts.length === 2) {
            const [key, value] = parts;
            config[key.trim()] = value.trim();
        }
    }

    return {
        secondsBetweenEachRequest: parseInt(config.seconds_between_each_request, 10) * 1000,
        secondsBetweenEachBatch: parseInt(config.seconds_between_each_batch, 10) * 1000,
        datesToSearch: config.dates_to_search.split(','),
        minimumDepartureTime: config.minimum_departure_time,
        trainTypeDirectOnly: config.train_type_direct_only === 'true',
        maximumTicketPrice: parseInt(config.maximum_ticket_price, 10),
    };
}

// --- Core Logic ---
async function checkAllItineraries() {
    console.log('--- Starting new check cycle ---');
    try {
        const appConfig = parseConfig();
        const payloadContent = fs.readFileSync('payload.json', 'utf-8');
        const basePayload: any = JSON.parse(payloadContent);
        const headersContent = fs.readFileSync('headers.json', 'utf-8');
        const headers: Record<string, string> = JSON.parse(headersContent);

        const baseItineraryName = `${basePayload.mainJourney.origin.label}-${basePayload.mainJourney.destination.label}`;

        for (const date of appConfig.datesToSearch) {
            const dynamicPayload = JSON.parse(JSON.stringify(basePayload));
            const originalDate = new Date(dynamicPayload.schedule.outward.date);
            const timePart = originalDate.toISOString().split('T')[1];
            dynamicPayload.schedule.outward.date = `${date}T${timePart}`;
            
            const itineraryName = `${baseItineraryName} on ${date}`;
            await fetchItinerary(itineraryName, dynamicPayload, headers, appConfig);
            
            await new Promise(resolve => setTimeout(resolve, appConfig.secondsBetweenEachRequest));
        }
    } catch (error) {
        console.error("Error during check cycle:", error);
    }
}

async function fetchItinerary(itineraryName: string, payload: object, headers: Record<string, string>, config: AppConfig) {
    console.log(`Fetching initial itineraries for ${itineraryName}...`);
    const url = 'https://www.sncf-connect.com/bff/api/v1/itineraries';

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status} for ${itineraryName}`);
            const errorText = await response.text();
            console.error('Error response body:', errorText);
            return;
        }

        const data: ItineraryResponse = await response.json();
        const itineraryId = data.itineraryId || data.longDistance?.itineraryId;
        
        const initialProposals: Proposal[] = data.longDistance?.proposals?.proposals || data.proposals || [];
        console.log(`Found ${initialProposals.length} proposals from initial request for ${itineraryName}.`);
        if (initialProposals.length > 0) {
            processProposals(itineraryName, initialProposals, config);
        }

        let moreProposals: Proposal[] = [];
        if (itineraryId) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const morePayloadContent = fs.readFileSync('payload_more.json', 'utf-8');
            const morePayload = JSON.parse(morePayloadContent);
            morePayload.itineraryId = itineraryId;

            console.log(`Fetching more itineraries for ${itineraryName}...`);
            const moreResponse = await fetch('https://www.sncf-connect.com/bff/api/v1/itineraries/more', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(morePayload)
            });

            if (moreResponse.ok) {
                const moreData: ItineraryResponse = await moreResponse.json();
                moreProposals = moreData.longDistance?.proposals?.proposals || moreData.proposals || [];
                console.log(`Found ${moreProposals.length} more proposals for ${itineraryName}.`);
                if (moreProposals.length > 0) {
                    processProposals(itineraryName, moreProposals, config);
                }
            } else {
                console.error(`HTTP error on fetching more itineraries! status: ${moreResponse.status} for ${itineraryName}`);
                const errorText = await moreResponse.text();
                console.error('Error response body for more itineraries:', errorText);
            }
        }

        if (initialProposals.length === 0 && moreProposals.length === 0) {
            fs.writeFileSync('output.txt', JSON.stringify(data, null, 2));
            console.log(`No proposals found for ${itineraryName} after both requests. API response saved to output.txt.`);
        }
    } catch (error) {
        console.error(`An error occurred while fetching the data for ${itineraryName}:`, error);
    }
}

function logNewOffers(itineraryName: string, proposal: Proposal, offers: Offer[], isUpdate: boolean = false) {
    let message = `<b>${itineraryName}</b>\n`;
    if (isUpdate) {
        message += `--- Nouvelle(s) offre(s) pour le train de ${proposal.departure.timeLabel} ---\n`;
    } else {
        message += '--- Nouvelle offre directe trouvée! ---\n';
    }
    message += `Depart : ${proposal.departure.timeLabel} ${proposal.departure.dateLabel}\n`;
    message += `Arrivée : ${proposal.arrival.timeLabel} ${proposal.arrival.dateLabel}\n`;
    message += `Duree : ${proposal.durationLabel}\n`;
    message += `Type : ${proposal.transporterDescription}\n`;
    message += 'Offres :\n';
    offers.forEach(offer => {
        const price = offer.priceLabel;
        const className = offer.comfortClass.label.includes('1') ? '1er classe' : '2de classe';
        message += `- ${className} : ${price}\n`;
    });
    message += 'Lien pour achat: <a href="https://www.sncf-connect.com/">SNCF Connect</a>\n';
    message += '------------------------------------';

    console.log(message);
    sendTelegramMessage(message);
}

// --- Main Execution ---
async function main() {
    console.log('Script execution started.');
    while (true) {
        await checkAllItineraries();
        let delay = 10000; // Default delay of 10 seconds
        try {
            const config = parseConfig();
            delay = config.secondsBetweenEachBatch;
        } catch (error) {
            console.error("Failed to read config for batch delay, using default 10 seconds.", error);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

main().catch(e => {
    console.error("The main execution loop crashed.", e);
    process.exit(1);
});
