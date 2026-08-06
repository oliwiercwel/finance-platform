FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend files
COPY backend/requirements.txt .
COPY backend/server.py .

# Copy frontend files
COPY frontend/ ./frontend/

# Expose port
EXPOSE 8080

# Run server
CMD ["python", "backend/server.py"]