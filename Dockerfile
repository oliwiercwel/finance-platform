FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy backend files
COPY backend/package*.json ./
RUN npm install --production

# Copy backend source
COPY backend/ ./

# Copy frontend files
COPY frontend/ ./frontend/

# Expose port
EXPOSE 3000

# Run server
CMD ["node", "server.js"]