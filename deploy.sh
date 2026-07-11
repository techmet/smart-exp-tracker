#!/bin/bash

# Exit immediately if any command fails
set -e

# Load NVM (Node Version Manager) if installed to ensure we use Node 22+
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  # Try to use Node 22 or Node 20.12+ (which contains styleText in util)
  nvm use 22 || nvm use default || true
fi

# Ensure Node path is in environment if installed via homebrew/nvm
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Text colors using printf (fully compatible with sh/bash)
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

printf "${BLUE}===============================================${NC}\n"
printf "${BLUE}   Smart Expense Tracker - PWA Deployer        ${NC}\n"
printf "${BLUE}===============================================${NC}\n\n"

# 1. Stage files
printf "${YELLOW}[1/4] Staging files...${NC}\n"
git add .

# 2. Get commit message
default_msg="Update PWA layouts and categories"
printf "${YELLOW}[2/4] Prepare commit message:${NC}\n"
read -p "Enter commit message (Press Enter for default: '$default_msg'): " commit_msg

if [ -z "$commit_msg" ]; then
  commit_msg="$default_msg"
fi

printf "Committing with message: \"$commit_msg\"\n"
git commit -m "$commit_msg" || printf "${BLUE}No changes detected, skipping commit.${NC}\n"

# 3. Detect current branch and push
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
printf "\n${YELLOW}[3/4] Pushing code to GitHub '$CURRENT_BRANCH' branch...${NC}\n"
git push origin "$CURRENT_BRANCH"

# 4. Deploy web PWA
printf "\n${YELLOW}[4/4] Building and deploying PWA to GitHub Pages...${NC}\n"
cd web
npm run deploy

printf "\n${GREEN}🚀 SUCCESS! Your PWA has been successfully compiled and published!${NC}\n"
printf "${GREEN}Open the link in Safari/Chrome on your phone to install the update.${NC}\n"
