import express from "express";
import axios from "axios";
import dotenv from "dotenv";

// Initialize Redis client with env variables
const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD || undefined
  });

  // Configure axios instance with authentication
const axiosInstance = axios.create({
    baseURL: process.env.SOCIAL_MEDIA_API_BASE_URL,
    headers: { 
      "Authorization": Bearer ${process.env.ACCESS_TOKEN},
      "Content-Type": "application/json"
    }
  });

  // Middleware for json response
app.use(express.json());

// Cache middleware using env variable
const cache = (key, ttl = process.env.CACHE_TTL_SECONDS) => async (req, res, next) => {
    const cacheKey = ${key}_${process.env.ACCESS_TOKEN.slice(-6)};
    try {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }
      res.sendResponse = res.json;
      res.json = (data) => {
        redis.setex(cacheKey, ttl, JSON.stringify(data));
        res.sendResponse(data);
      };
      next();
    } catch (err) {
      next();
    }

};


// code 



// Background data refresh using env variable
const refreshInterval = process.env.DATA_REFRESH_INTERVAL_MINUTES * 60 * 1000;
setInterval(refreshData, refreshInterval);

// Server startup
const PORT = process.env.SERVER_PORT || 3000;
app.listen(PORT, () => {
  console.log(Server running on port ${PORT});
});