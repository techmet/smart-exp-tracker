#!/bin/bash

# Exit immediately if any command fails
set -e

# Text colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}===============================================${NC}"
echo -e "${BLUE}   Smart Expense Tracker - PWA Deployer        ${NC}"
echo -e "${BLUE}===============================================${NC}\n"

# 1. Stage files
echo -e "${YELLOW}[1/4] Staging files...${NC}"
git add .

# 2. Get commit message
default_msg="Update PWA layouts and categories"
echo -e "${YELLOW}[2/4] Prepare commit message:${NC}"
read -p "Enter commit message (Press Enter for default: '$default_msg'): " commit_msg

if [ -z "$commit_msg" ]; then
  commit_msg="$default_msg"
fi

echo -e "Committing with message: \"$commit_msg\""
# Commit, ignoring if there are no modifications to avoid failing the script
git commit -m "$commit_msg" || echo -e "${BLUE}No changes detected, skipping commit.${NC}"

# 3. Push code to main
echo -e "\n${YELLOW}[3/4] Pushing code to GitHub main branch...${NC}"
git push origin main

# 4. Deploy web PWA
echo -e "\n${YELLOW}[4/4] Building and deploying PWA to GitHub Pages...${NC}"
cd web
npm run deploy

echo -e "\n${GREEN}🚀 SUCCESS! Your PWA has been successfully compiled and published!${NC}"
echo -e "${GREEN}Open the link in Safari/Chrome on your phone to install the update.${NC}"
