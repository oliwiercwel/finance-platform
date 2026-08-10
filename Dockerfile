FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy backend files to backend subdirectory
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copy backend source
COPY backend/ ./backend/

# Copy frontend files to frontend subdirectory (sibling of backend)
COPY frontend/ ./frontend/

# Expose port
EXPOSE 3000

# Run server from backend directory
WORKDIR /app/backend
CMD ["node", "server.js"]