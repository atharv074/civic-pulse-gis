const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cors = require("cors");

// Allow all origins
app.use(cors());
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 1. CREATE THE APP FIRST
const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "civic_pulse_secret_key_123";

// 2. NOW USE MIDDLEWARE ON APP
app.use(
  cors({
    origin: [
      "https://civic-pulse-gis.vercel.app",
      "https://civic-pulse-gis-1.onrender.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve uploaded images publicly
app.use("/uploads", express.static(uploadsDir));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// MongoDB Connection (Fallback to local only if MONGO_URI is missing)
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/civic_reporting";

// SCHEMAS & MODELS
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const Admin = mongoose.model("Admin", adminSchema);

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: {
    type: String,
    enum: ["Pothole", "Streetlight", "Garbage", "Water Leakage", "Other"],
    default: "Other",
  },
  status: {
    type: String,
    enum: ["Pending", "In Progress", "Resolved"],
    default: "Pending",
  },
  imageUrl: { type: String, default: "" },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
  },
  createdAt: { type: Date, default: Date.now },
});

issueSchema.index({ location: "2dsphere" });
const Issue = mongoose.model("Issue", issueSchema);

// Connect MongoDB and Seed Admin
mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ Connected to MongoDB successfully");
    const existingAdmin = await Admin.findOne({ username: "admin" });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await Admin.create({ username: "admin", password: hashedPassword });
      console.log(
        "🔑 Default Admin created: Username: admin | Password: admin123",
      );
    }
  })
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// AUTH MIDDLEWARE
const verifyAdminToken = (req, res, next) => {
  const tokenHeader = req.headers["authorization"];
  if (!tokenHeader) {
    return res
      .status(401)
      .json({ error: "Access denied. Admin authorization required." });
  }

  const token = tokenHeader.startsWith("Bearer ")
    ? tokenHeader.slice(7)
    : tokenHeader;

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = verified;
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid or expired token." });
  }
};

// --- API ROUTES ---

app.get("/", (req, res) => {
  res.send("Civic Issue API Server Running");
});

app.get("/api/issues", async (req, res) => {
  try {
    const issues = await Issue.find().sort({ createdAt: -1 });
    res.json(issues);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

app.post("/api/issues", upload.single("image"), async (req, res) => {
  try {
    const { title, description, category, latitude, longitude } = req.body;

    let imageUrl = "";
    if (req.file) {
      // Dynamic Host Domain (Works locally and on Render)
      const protocol = req.protocol;
      const host = req.get("host");
      imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    }

    const newIssue = new Issue({
      title,
      description,
      category,
      imageUrl,
      location: {
        type: "Point",
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      },
    });

    await newIssue.save();
    res.status(201).json(newIssue);
  } catch (err) {
    res
      .status(400)
      .json({ error: "Failed to create report", details: err.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });

    if (!admin) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign(
      { id: admin._id, username: admin.username },
      JWT_SECRET,
      { expiresIn: "12h" },
    );
    res.json({ token, username: admin.username });
  } catch (err) {
    console.error("Login Error:", err);
    res
      .status(500)
      .json({ error: "Login failed server error", details: err.message });
  }
});

app.patch("/api/issues/:id", verifyAdminToken, async (req, res) => {
  try {
    const { status } = req.body;
    const updatedIssue = await Issue.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );
    res.json(updatedIssue);
  } catch (err) {
    res.status(400).json({ error: "Failed to update status" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
