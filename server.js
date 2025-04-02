import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config();

const requiredEnvVars = ['SOCIAL_MEDIA_API_BASE_URL', 'ACCESS_TOKEN'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
let redis;
let useRedis = true;

try {
  redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  redis.on("connect", () => console.log("Connected to Redis"));
  redis.on("error", (err) => {
    console.error("Redis error:", err.message);
    useRedis = false;
  });
} catch (err) {
  console.error("Failed to initialize Redis:", err.message);
  useRedis = false;
}

const axiosInstance = axios.create({
  baseURL: process.env.SOCIAL_MEDIA_API_BASE_URL,
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

axiosInstance.interceptors.response.use(
  response => response,
  error => {
    console.error("API Error:", error.response?.status, error.response?.data || error.message);
    return Promise.reject(error);
  }
);

app.use(express.json());

const cache = (key, ttl = parseInt(process.env.CACHE_TTL_SECONDS) || 60) => async (req, res, next) => {
  const cacheKey = `${key}_${process.env.ACCESS_TOKEN?.slice(-6) || 'default'}`;
  try {
    if (useRedis) {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) return res.json(JSON.parse(cachedData));
    }

    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (useRedis) redis.setex(cacheKey, ttl, JSON.stringify(data)).catch(err => console.error("Cache set error:", err));
      originalJson(data);
    };
    next();
  } catch (err) {
    console.error("Cache middleware error:", err.message);
    next();
  }
};

async function fetchAllUsers() {
  try {
    const response = await axiosInstance.get("/users");
    return response.data.users || {};
  } catch (error) {
    console.error("Error fetching users:", error.message);
    return {};
  }
}

async function fetchUserPosts(userId) {
  try {
    const response = await axiosInstance.get(`/users/${userId}/posts`);
    return response.data.posts || [];
  } catch (error) {
    console.error(`Error fetching posts for user ${userId}:`, error.message);
    return [];
  }
}

async function updateUserPostCounts() {
  try {
    const users = await fetchAllUsers();
    const userIds = Object.keys(users);
    if (useRedis) {
      const pipeline = redis.pipeline();
      for (const userId of userIds) {
        const posts = await fetchUserPosts(userId);
        pipeline.zadd("user_post_counts", posts.length, userId);
      }
      await pipeline.exec();
    }
  } catch (error) {
    console.error("Error updating user post counts:", error.message);
  }
}

const rateLimit = (req, res, next) => next();

app.get("/users", rateLimit, cache("top_users"), async (req, res) => {
  try {
    let topUsers = useRedis ? await redis.zrevrange("user_post_counts", 0, 4, "WITHSCORES") : [];
    if (!topUsers.length) await updateUserPostCounts();
    if (useRedis) topUsers = await redis.zrevrange("user_post_counts", 0, 4, "WITHSCORES");
    const users = await fetchAllUsers();
    res.json(topUsers.map(([userId, postCount]) => ({ user_id: userId, name: users[userId] || "Unknown", post_count: parseInt(postCount) })) || []);
  } catch (error) {
    console.error("Error in /users endpoint:", error.message);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    server_time: new Date().toISOString(),
    redis_status: useRedis ? "connected" : "disabled",
    memory_usage: process.memoryUsage(),
    uptime: process.uptime(),
  });
});

const shutdown = async () => {
  console.log("Shutting down gracefully...");
  try {
    if (useRedis) await redis.quit();
    console.log("Cleanup complete");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err.message);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const PORT = parseInt(process.env.SERVER_PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Redis connection: ${useRedis ? 'Enabled' : 'Disabled'}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
