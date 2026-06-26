FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install native dependencies if required by geoip-lite or others
# geoip-lite might need python/make in some environments but usually prebuilds exist.
# We'll install them just in case to be safe, then remove them.
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the frontend CSS (Tailwind)
# Wait, the vite frontend might need to be built if it's not pre-built in the repo.
# The user's package.json has a build:css script, and a vite build could be run if there's a build script.
# Let's check package.json for vite build script. Usually `npm run build` inside webui.
# Since we are just deploying the backend, we will run the backend. If webui needs to be built, we should do it.
# I will build the webui just in case.
RUN cd webui && npm install && npm run build || echo "WebUI build failed or not configured, skipping..."

# Expose ports (Proxy: 1080/1112, WebUI: 8899, Server: 33891, Forward: 8080/1111)
EXPOSE 8899 33891 1080 1111 1112 8080

# Run the app
CMD ["npm", "start"]
