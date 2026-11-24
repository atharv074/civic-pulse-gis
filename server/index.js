const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, ".env") });
const { GoogleGenAI } = require("@google/genai");

// 1. INITIALIZE APP FIRST
const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "civic_pulse_secret_key_123";

// Post-Visit Architecture: 30m Spatial Radius & Two-Tier Taxonomy
const DUPLICATE_RADIUS_METERS = 30;
const TAXONOMY = {
  "Road Infrastructure": [
    "Open Pothole",
    "Broken Curb",
    "Damaged Road Surface",
  ],
  "Streetlight & Power": [
    "Non-Working Streetlight",
    "Flickering Lamp",
    "Exposed Wire",
  ],
  "Sanitation & Waste": [
    "Overflowing Garbage Bin",
    "Illegal Dumping",
    "Sweeping Missed",
  ],
  "Water & Drainage": ["Water Leakage", "Clogged Drain", "Sewage Overflow"],
  "Other Civic Hazard": [
    "Fallen Tree / Branch",
    "Damaged Signboard",
    "General Hazard",
  ],
};

// 2. NOW APPLY CORS & MIDDLEWARE TO APP
const allowedOrigins = [
  "https://civic-pulse-gis.vercel.app",
  "https://civic-pulse-gis-1.onrender.com",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded images publicly
app.use("/uploads", express.static(uploadsDir));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname || ".jpg"));
  },
});
const upload = multer({ storage });

// Gemini Client & Visual Triage Helper (Server-side)
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

async function runGeminiTriage(filePath, mimeType, fallbackMain, fallbackSub) {
  const fallback = {
    isValidCivicIssue: true,
    suggestedMainCategory: fallbackMain || "Other Civic Hazard",
    suggestedSubCategory: fallbackSub || "General Hazard",
    severityScore: 5,
    summary: "Visual triage fallback used (no API key or image).",
  };

  if (!ai || !filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const base64Image = fs.readFileSync(filePath).toString("base64");
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType || "image/jpeg",
            data: base64Image,
          },
        },
        `Inspect this urban civic hazard photo and return ONLY valid JSON:
{
  "isValidCivicIssue": boolean,
  "suggestedMainCategory": string,
  "suggestedSubCategory": string,
  "severityScore": number,
  "summary": string
}
Choose categories from: ${JSON.stringify(TAXONOMY)}.
severityScore must be an integer from 1 to 10.`,
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text);
    const mainCat = TAXONOMY[parsed.suggestedMainCategory]
      ? parsed.suggestedMainCategory
      : fallbackMain || "Other Civic Hazard";
    const subOptions = TAXONOMY[mainCat];
    const subCat = subOptions.includes(parsed.suggestedSubCategory)
      ? parsed.suggestedSubCategory
      : fallbackSub || subOptions[0];

    return {
      isValidCivicIssue: Boolean(parsed.isValidCivicIssue ?? true),
      suggestedMainCategory: mainCat,
      suggestedSubCategory: subCat,
      severityScore: Math.min(
        10,
        Math.max(1, Number(parsed.severityScore) || 5),
      ),
      summary: String(parsed.summary || "Civic hazard analyzed."),
    };
  } catch (err) {
    console.warn("Gemini triage failed, using fallback:", err.message);
    return fallback;
  }
}

function buildPublicFileUrl(req, filename) {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${protocol}://${host}/uploads/${filename}`;
}

// MongoDB Connection
const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/civic_reporting";

// SCHEMAS & MODELS
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["super_admin", "ward_officer"],
    default: "ward_officer",
  },
  assignedWard: { type: String, default: "Ward 1 - Akurdi/Nigdi" },
});
const Admin = mongoose.model("Admin", adminSchema);

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },

  // Backward-compatible flat category + Post-Visit Two-Tier Taxonomy
  category: { type: String, default: "Other" },
  mainCategory: { type: String, default: "Other Civic Hazard" },
  subCategory: { type: String, default: "General Hazard" },
  ward: { type: String, default: "Ward 1 - Akurdi/Nigdi", index: true },

  // Post-Visit 30m Spatial Duplicate Aggregation
  masterIssueId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Issue",
    default: null,
  },
  reportCount: { type: Number, default: 1 },
  priorityScore: { type: Number, default: 1 },
  linkedReports: [
    {
      title: String,
      description: String,
      imageUrl: String,
      submittedAt: { type: Date, default: Date.now },
    },
  ],

  // Post-Visit Gemini Visual Triage Result
  aiTriage: {
    isValidCivicIssue: { type: Boolean, default: true },
    suggestedMainCategory: { type: String, default: "Other Civic Hazard" },
    suggestedSubCategory: { type: String, default: "General Hazard" },
    severityScore: { type: Number, default: 5 },
    summary: { type: String, default: "" },
  },

  // Post-Visit Resolution Proof & Lifecycle Timestamps
  resolutionPhotoUrl: { type: String, default: "" },
  resolvedBy: { type: String, default: "" },
  assignedAt: { type: Date, default: null },
  inProgressAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },

  status: {
    type: String,
    enum: [
      "Submitted",
      "AI Triaged",
      "Assigned to Ward",
      "In Progress",
      "Resolved",
      "Pending",
    ],
    default: "AI Triaged",
  },
  imageUrl: { type: String, default: "" },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  createdAt: { type: Date, default: Date.now },
});

issueSchema.index({ location: "2dsphere" });
const Issue = mongoose.model("Issue", issueSchema);

// Connect MongoDB and Seed Default Super Admin + Sample Ward Officer
mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ Connected to MongoDB successfully");

    const existingSuperAdmin = await Admin.findOne({ username: "admin" });
    if (!existingSuperAdmin) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await Admin.create({
        username: "admin",
        password: hashedPassword,
        role: "super_admin",
        assignedWard: "ALL",
      });
      console.log(
        "🔑 Default Super Admin created: Username: admin | Password: admin123",
      );
    } else if (!existingSuperAdmin.role) {
      existingSuperAdmin.role = "super_admin";
      existingSuperAdmin.assignedWard = "ALL";
      await existingSuperAdmin.save();
    }

    const existingOfficer = await Admin.findOne({ username: "officer1" });
    if (!existingOfficer) {
      const officerPassword = await bcrypt.hash("officer123", 10);
      await Admin.create({
        username: "officer1",
        password: officerPassword,
        role: "ward_officer",
        assignedWard: "Ward 1 - Akurdi/Nigdi",
      });
      console.log(
        "👮 Default Ward Officer created: Username: officer1 | Password: officer123",
      );
    }
  })
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// AUTH & 3-TIER RBAC MIDDLEWARE
const verifyAdminToken = (req, res, next) => {
  const tokenHeader = req.headers["authorization"];
  if (!tokenHeader) {
    return res
      .status(401)
      .json({ error: "Access denied. Authorization token required." });
  }

  const token = tokenHeader.startsWith("Bearer ")
    ? tokenHeader.slice(7)
    : tokenHeader;

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = {
      ...verified,
      role: verified.role || "ward_officer",
      assignedWard: verified.assignedWard || "Ward 1 - Akurdi/Nigdi",
    };
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid or expired token." });
  }
};

const requireRole =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.admin || !allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        error: `Forbidden: requires role [${allowedRoles.join(", ")}].`,
      });
    }
    next();
  };

// --- API ROUTES ---

app.get("/", (req, res) => {
  res.send("Civic Issue API Server Running");
});

app.get(["/issues", "/api/issues"], async (req, res) => {
  try {
    const filter = { masterIssueId: null };
    if (req.query.ward) {
      filter.ward = req.query.ward;
    }
    const issues = await Issue.find(filter).sort({
      priorityScore: -1,
      createdAt: -1,
    });
    res.json(issues);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

// Citizen public issue submission (Role: citizen)
app.post(
  ["/issues", "/api/issues"],
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        title,
        description,
        category,
        mainCategory,
        subCategory,
        ward,
        latitude,
        longitude,
      } = req.body;

      const lng = parseFloat(longitude);
      const lat = parseFloat(latitude);
      if (Number.isNaN(lng) || Number.isNaN(lat)) {
        return res
          .status(400)
          .json({ error: "Valid latitude and longitude are required." });
      }

      let imageUrl = "";
      if (req.file) {
        imageUrl = buildPublicFileUrl(req, req.file.filename);
      }

      const resolvedMain = mainCategory || "Other Civic Hazard";
      const resolvedSub = subCategory || category || "General Hazard";
      const resolvedWard = ward || "Ward 1 - Akurdi/Nigdi";

      // Run Gemini Visual Triage on uploaded photo
      const triage = await runGeminiTriage(
        req.file?.path,
        req.file?.mimetype,
        resolvedMain,
        resolvedSub,
      );

      const finalMain = mainCategory || triage.suggestedMainCategory;
      const finalSub = subCategory || triage.suggestedSubCategory;

      // 30-meter spatial proximity query on unresolved master tickets of same subCategory
      const existingMaster = await Issue.findOne({
        masterIssueId: null,
        subCategory: finalSub,
        status: { $ne: "Resolved" },
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [lng, lat] },
            $maxDistance: DUPLICATE_RADIUS_METERS,
          },
        },
      });

      if (existingMaster) {
        existingMaster.reportCount += 1;
        existingMaster.priorityScore = Number(
          (
            existingMaster.priorityScore +
            1 +
            (triage.severityScore || 5) * 0.25
          ).toFixed(2),
        );
        existingMaster.linkedReports.push({
          title,
          description,
          imageUrl,
          submittedAt: new Date(),
        });
        await existingMaster.save();

        await Issue.create({
          title,
          description,
          category: category || finalSub,
          mainCategory: finalMain,
          subCategory: finalSub,
          ward: resolvedWard,
          masterIssueId: existingMaster._id,
          aiTriage: triage,
          imageUrl,
          status: existingMaster.status,
          location: { type: "Point", coordinates: [lng, lat] },
        });

        return res.status(200).json({
          ...existingMaster.toObject(),
          deduplicated: true,
          radiusMeters: DUPLICATE_RADIUS_METERS,
        });
      }

      const initialPriority = Number(
        (1 + (triage.severityScore || 5) * 0.5).toFixed(2),
      );

      const newIssue = new Issue({
        title,
        description,
        category: category || finalSub,
        mainCategory: finalMain,
        subCategory: finalSub,
        ward: resolvedWard,
        priorityScore: initialPriority,
        aiTriage: triage,
        imageUrl,
        status: "AI Triaged",
        location: { type: "Point", coordinates: [lng, lat] },
      });

      await newIssue.save();
      return res.status(201).json({
        ...newIssue.toObject(),
        deduplicated: false,
      });
    } catch (err) {
      res
        .status(400)
        .json({ error: "Failed to create report", details: err.message });
    }
  },
);

app.post(["/admin/login", "/api/admin/login"], async (req, res) => {
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

    const role = admin.role || "ward_officer";
    const assignedWard =
      admin.assignedWard ||
      (role === "super_admin" ? "ALL" : "Ward 1 - Akurdi/Nigdi");

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role, assignedWard },
      JWT_SECRET,
      { expiresIn: "12h" },
    );
    res.json({ token, username: admin.username, role, assignedWard });
  } catch (err) {
    console.error("Login Error:", err);
    res
      .status(500)
      .json({ error: "Login failed server error", details: err.message });
  }
});

// Status update with RBAC + Mandatory Resolution Photo Proof + Timestamps
app.patch(
  ["/issues/:id", "/api/issues/:id"],
  verifyAdminToken,
  requireRole("ward_officer", "super_admin"),
  upload.single("resolutionPhoto"),
  async (req, res) => {
    try {
      const issue = await Issue.findById(req.params.id);
      if (!issue) {
        return res.status(404).json({ error: "Issue not found" });
      }

      // Ward officers can only update issues in their assigned ward
      if (
        req.admin.role === "ward_officer" &&
        req.admin.assignedWard &&
        req.admin.assignedWard !== "ALL" &&
        issue.ward &&
        issue.ward !== req.admin.assignedWard
      ) {
        return res.status(403).json({
          error: `Forbidden: you are assigned to ${req.admin.assignedWard}, not ${issue.ward}.`,
        });
      }

      const nextStatus = req.body.status || issue.status;
      const now = new Date();

      if (req.file) {
        issue.resolutionPhotoUrl = buildPublicFileUrl(req, req.file.filename);
      }

      // Enforce mandatory resolution photo proof when transitioning to Resolved
      if (nextStatus === "Resolved" && !issue.resolutionPhotoUrl) {
        return res.status(400).json({
          error:
            "Resolution photo proof is mandatory before marking an issue as Resolved.",
        });
      }

      if (nextStatus === "Assigned to Ward" && !issue.assignedAt) {
        issue.assignedAt = now;
      }
      if (nextStatus === "In Progress" && !issue.inProgressAt) {
        issue.inProgressAt = now;
      }
      if (nextStatus === "Resolved") {
        issue.resolvedAt = issue.resolvedAt || now;
        issue.resolvedBy = req.admin.username;
      }

      issue.status = nextStatus;
      await issue.save();

      res.json(issue);
    } catch (err) {
      res
        .status(400)
        .json({ error: "Failed to update status", details: err.message });
    }
  },
);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
