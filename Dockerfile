# Gunakan image Node.js versi LTS
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json dan package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port (default 3000, tapi Fly.io menggunakan port 8080 secara internal)
ENV PORT=8080
EXPOSE 8080

# Start the app
CMD [ "node", "server.js" ]
