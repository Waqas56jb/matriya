FROM node:20-bookworm-slim

# Install Python 3 + pip (required for the science pipeline)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Create isolated venv so pip doesn't conflict with system packages
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

RUN pip install --upgrade pip

WORKDIR /app

# Install Node dependencies first (layer-cached separately from source)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install Python science dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
# Ensure Python subprocess always resolves to the venv python3
ENV PYTHON_CMD=python3

EXPOSE 3001
CMD ["npm", "start"]
