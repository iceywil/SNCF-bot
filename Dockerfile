# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Remove development dependencies
RUN npm prune --production

# Stage 2: Create the production image
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy the pruned node_modules and the built application from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/payload.json ./payload.json
COPY --from=builder /usr/src/app/headers.json ./headers.json
COPY --from=builder /usr/src/app/config.txt ./config.txt


# The command to run your app
CMD [ "npm", "start" ]
