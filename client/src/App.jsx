import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet marker fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Normalize API Base URL (removes trailing slashes to avoid //issues 404s)
const RAW_URL =
  import.meta.env.VITE_API_BASE_URL || "https://civic-pulse-gis-1.onrender.com";
const API_BASE_URL = RAW_URL.replace(/\/+$/, "");

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

const WARDS = [
  "Ward 1 - Akurdi/Nigdi",
  "Ward 2 - Chinchwad",
  "Ward 3 - Pimpri",
  "Ward 4 - Bhosari",
  "Ward 5 - Shivajinagar / PMC",
];

const LIFECYCLE_STEPS = [
  "Submitted",
  "AI Triaged",
  "Assigned to Ward",
  "In Progress",
  "Resolved",
];

function LocationMarker({ position, setPosition }) {
  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
    },
  });

  return position === null ? null : (
    <Marker position={position}>
      <Popup>Selected Location for Issue</Popup>
    </Marker>
  );
}

function StatusBadge({ status }) {
  const styles = {
    Resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
    "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
    "Assigned to Ward": "bg-indigo-100 text-indigo-800 border-indigo-200",
    "AI Triaged": "bg-purple-100 text-purple-800 border-purple-200",
    Submitted: "bg-slate-100 text-slate-700 border-slate-200",
    Pending: "bg-amber-100 text-amber-800 border-amber-200",
  };
  const cls = styles[status] || "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-block text-xs px-2.5 py-0.5 rounded-full font-semibold border ${cls}`}
    >
      {String(status || "Submitted")}
    </span>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("explore");
  const [issues, setIssues] = useState([]);
  const [filterMainCategory, setFilterMainCategory] = useState("All");
  const [filterWard, setFilterWard] = useState("All");

  // Auth / 3-Tier RBAC state
  const [adminToken, setAdminToken] = useState(
    localStorage.getItem("adminToken") || "",
  );
  const [adminUser, setAdminUser] = useState(
    localStorage.getItem("adminUser") || "",
  );
  const [adminRole, setAdminRole] = useState(
    localStorage.getItem("adminRole") || "",
  );
  const [adminWard, setAdminWard] = useState(
    localStorage.getItem("adminWard") || "",
  );
  const [loginCreds, setLoginCreds] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");

  // Form state (Two-Tier Taxonomy + Ward)
  const initialMain = "Road Infrastructure";
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    mainCategory: initialMain,
    subCategory: TAXONOMY[initialMain][0],
    ward: WARDS[0],
  });
  const [file, setFile] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [submitStatus, setSubmitStatus] = useState(null); // { type: 'success' | 'info' | 'error', text: string, meta?: object }
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Per-row management status & resolution photo state
  const [statusDrafts, setStatusDrafts] = useState({});
  const [resolutionPhotos, setResolutionPhotos] = useState({});
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    fetchIssues();
  }, []);

  const fetchIssues = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/issues`);
      if (Array.isArray(response.data)) {
        setIssues(response.data);
        const drafts = {};
        response.data.forEach((item) => {
          if (item?._id) {
            drafts[item._id] = item.status || "AI Triaged";
          }
        });
        setStatusDrafts(drafts);
      } else {
        setIssues([]);
      }
    } catch (err) {
      console.error("Error fetching issues:", err);
      setIssues([]);
    }
  };

  const handleMainCategoryChange = (newMain) => {
    const firstSub = TAXONOMY[newMain]?.[0] || "General Hazard";
    setFormData((prev) => ({
      ...prev,
      mainCategory: newMain,
      subCategory: firstSub,
    }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await axios.post(`${API_BASE_URL}/admin/login`, loginCreds);
      const role = res.data.role || "ward_officer";
      const assignedWard = res.data.assignedWard || "Ward 1 - Akurdi/Nigdi";

      setAdminToken(res.data.token);
      setAdminUser(res.data.username);
      setAdminRole(role);
      setAdminWard(assignedWard);

      localStorage.setItem("adminToken", res.data.token);
      localStorage.setItem("adminUser", res.data.username);
      localStorage.setItem("adminRole", role);
      localStorage.setItem("adminWard", assignedWard);
      setLoginCreds({ username: "", password: "" });
    } catch (err) {
      console.error("Login Error:", err);
      let message = "Failed to log in.";
      if (typeof err.response?.data?.error === "string") {
        message = err.response.data.error;
      } else if (typeof err.response?.data?.message === "string") {
        message = err.response.data.message;
      } else if (typeof err.response?.data === "string") {
        message = err.response.data;
      } else if (err.message) {
        message = err.message;
      }
      setLoginError(message);
    }
  };

  const handleLogout = () => {
    setAdminToken("");
    setAdminUser("");
    setAdminRole("");
    setAdminWard("");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    localStorage.removeItem("adminRole");
    localStorage.removeItem("adminWard");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!selectedLocation) {
      alert("Please click on the map to set an issue location!");
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const payload = new FormData();
      payload.append("title", formData.title);
      payload.append("description", formData.description);
      payload.append("mainCategory", formData.mainCategory);
      payload.append("subCategory", formData.subCategory);
      payload.append("category", formData.subCategory);
      payload.append("ward", formData.ward);
      payload.append("latitude", selectedLocation[0]);
      payload.append("longitude", selectedLocation[1]);
      if (file) {
        payload.append("image", file);
      }

      const res = await axios.post(`${API_BASE_URL}/issues`, payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const data = res.data || {};
      const triageInfo = data.aiTriage
        ? `Severity ${data.aiTriage.severityScore}/10 — ${data.aiTriage.summary}`
        : "";

      if (data.deduplicated) {
        setSubmitStatus({
          type: "info",
          text: `Merged into existing Master Ticket within ${data.radiusMeters || 30}m! Total reports at spot: ${data.reportCount} (Priority Score: ${data.priorityScore}).`,
          meta: triageInfo,
        });
      } else {
        setSubmitStatus({
          type: "success",
          text: "New Master Ticket created and triaged successfully!",
          meta: triageInfo,
        });
      }

      setFormData({
        title: "",
        description: "",
        mainCategory: initialMain,
        subCategory: TAXONOMY[initialMain][0],
        ward: WARDS[0],
      });
      setFile(null);
      setSelectedLocation(null);
      fetchIssues();
    } catch (err) {
      console.error("Error submitting issue:", err);
      const errMsg =
        typeof err.response?.data?.error === "string"
          ? err.response.data.error
          : "Failed to submit issue. Please try again.";
      setSubmitStatus({ type: "error", text: errMsg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveStatusUpdate = async (issue) => {
    const id = issue._id;
    const nextStatus = statusDrafts[id] || issue.status;
    const photoFile = resolutionPhotos[id];

    if (nextStatus === "Resolved" && !photoFile && !issue.resolutionPhotoUrl) {
      alert(
        "Mandatory Resolution Proof: Please upload a resolution photo before marking this issue as Resolved.",
      );
      return;
    }

    setUpdatingId(id);
    try {
      const updatePayload = new FormData();
      updatePayload.append("status", nextStatus);
      if (photoFile) {
        updatePayload.append("resolutionPhoto", photoFile);
      }

      await axios.patch(`${API_BASE_URL}/issues/${id}`, updatePayload, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "multipart/form-data",
        },
      });

      setResolutionPhotos((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await fetchIssues();
    } catch (err) {
      const msg =
        typeof err.response?.data?.error === "string"
          ? err.response.data.error
          : "Failed to update status.";
      alert(msg);
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
    } finally {
      setUpdatingId("");
    }
  };

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      const issueMain =
        issue.mainCategory || issue.category || "Other Civic Hazard";
      const matchesCategory =
        filterMainCategory === "All" ||
        issueMain === filterMainCategory ||
        issue.category === filterMainCategory;
      const matchesWard =
        filterWard === "All" || (issue.ward || WARDS[0]) === filterWard;
      return matchesCategory && matchesWard;
    });
  }, [issues, filterMainCategory, filterWard]);

  const stats = useMemo(() => {
    const total = issues.length;
    const resolved = issues.filter((i) => i.status === "Resolved").length;
    const inProgress = issues.filter((i) =>
      ["In Progress", "Assigned to Ward"].includes(i.status),
    ).length;
    const triagedOrPending = total - resolved - inProgress;
    return { total, triagedOrPending, inProgress, resolved };
  }, [issues]);

  const leaderboardRows = useMemo(() => {
    const wardMap = new Map();
    for (const issue of issues) {
      const w = issue.ward || WARDS[0];
      if (!wardMap.has(w)) {
        wardMap.set(w, {
          ward: w,
          masterTickets: 0,
          totalReports: 0,
          resolvedCount: 0,
          points: 0,
        });
      }
      const row = wardMap.get(w);
      const count = Number(issue.reportCount) || 1;
      row.masterTickets += 1;
      row.totalReports += count;
      if (issue.status === "Resolved") {
        row.resolvedCount += 1;
      }
      row.points += count * 10 + (issue.status === "Resolved" ? 25 : 0);
    }
    return Array.from(wardMap.values()).sort((a, b) => b.points - a.points);
  }, [issues]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-indigo-700 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🛡️</span>
            <div>
              <h1 className="text-xl font-bold tracking-wide leading-tight">
                Civic Pulse GIS
              </h1>
              <p className="text-[11px] text-indigo-200">
                30m Spatial Clustering • Gemini Triage • Ward RBAC
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex space-x-1 bg-indigo-800 p-1 rounded-lg">
              {[
                { id: "explore", label: "Explore Map" },
                { id: "report", label: "Report Issue" },
                { id: "leaderboard", label: "Leaderboard" },
                { id: "management", label: "Management" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-2 rounded-md text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "bg-white text-indigo-700 shadow"
                      : "text-indigo-100 hover:bg-indigo-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {adminToken && (
              <div className="flex items-center space-x-2 bg-indigo-900 px-3 py-1.5 rounded-lg text-xs">
                <span>
                  👨‍💼 <strong>{String(adminUser)}</strong> (
                  {adminRole || "officer"}
                  {adminWard && adminWard !== "ALL" ? ` • ${adminWard}` : ""})
                </span>
                <button
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded text-white font-semibold"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col gap-4">
        {/* Metrics Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Master Incidents
              </p>
              <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            </div>
            <span className="text-2xl text-blue-500">📊</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Triaged / New
              </p>
              <p className="text-2xl font-bold text-amber-600">
                {stats.triagedOrPending}
              </p>
            </div>
            <span className="text-2xl text-amber-500">🤖</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Active / Assigned
              </p>
              <p className="text-2xl font-bold text-blue-600">
                {stats.inProgress}
              </p>
            </div>
            <span className="text-2xl text-blue-500">🕒</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Verified Resolved
              </p>
              <p className="text-2xl font-bold text-emerald-600">
                {stats.resolved}
              </p>
            </div>
            <span className="text-2xl text-emerald-500">✅</span>
          </div>
        </div>

        {/* TAB 1: Explore Map */}
        {activeTab === "explore" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1">
            <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-100 p-2 h-[540px]">
              <MapContainer
                key="explore-map"
                center={[18.6517, 73.7686]}
                zoom={12}
                className="h-full w-full rounded-lg"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {filteredIssues.map((issue) => {
                  if (
                    !issue?.location?.coordinates ||
                    !Array.isArray(issue.location.coordinates) ||
                    issue.location.coordinates.length < 2
                  ) {
                    return null;
                  }
                  const mainCat =
                    issue.mainCategory ||
                    issue.category ||
                    "Other Civic Hazard";
                  const subCat = issue.subCategory || issue.category || "";
                  return (
                    <Marker
                      key={issue._id || String(Math.random())}
                      position={[
                        issue.location.coordinates[1],
                        issue.location.coordinates[0],
                      ]}
                    >
                      <Popup>
                        <div className="p-1 max-w-[230px] space-y-1.5">
                          {issue.imageUrl && (
                            <img
                              src={issue.imageUrl}
                              alt={issue.title}
                              className="w-full h-24 object-cover rounded-lg border border-slate-200"
                            />
                          )}
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold">
                              {mainCat}
                            </span>
                            {subCat && (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                                {subCat}
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-sm text-slate-800">
                            {String(issue.title)}
                          </h3>
                          <p className="text-xs text-slate-600">
                            {String(issue.description)}
                          </p>
                          <div className="text-[11px] text-slate-700 bg-slate-50 p-1.5 rounded border">
                            <div>
                              <strong>Ward:</strong> {issue.ward || WARDS[0]}
                            </div>
                            <div>
                              <strong>Duplicates Merged:</strong>{" "}
                              {issue.reportCount || 1} (Priority:{" "}
                              {issue.priorityScore || 1})
                            </div>
                            {issue.aiTriage?.severityScore && (
                              <div>
                                <strong>AI Severity:</strong>{" "}
                                {issue.aiTriage.severityScore}/10
                              </div>
                            )}
                          </div>
                          <div className="pt-0.5">
                            <StatusBadge status={issue.status} />
                          </div>
                          {issue.status === "Resolved" &&
                            issue.resolutionPhotoUrl && (
                              <div className="pt-1 border-t">
                                <p className="text-[11px] font-bold text-emerald-700 mb-1">
                                  Resolution Proof:
                                </p>
                                <img
                                  src={issue.resolutionPhotoUrl}
                                  alt="Resolution proof"
                                  className="w-full h-20 object-cover rounded border border-emerald-200"
                                />
                              </div>
                            )}
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 space-y-4">
              <div>
                <h2 className="font-bold text-slate-800 mb-2">
                  Filter by Category
                </h2>
                <div className="flex flex-col gap-1.5">
                  {["All", ...Object.keys(TAXONOMY)].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFilterMainCategory(cat)}
                      className={`text-left px-3 py-2 rounded-lg text-xs font-medium transition ${
                        filterMainCategory === cat
                          ? "bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-600"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Ward Filter
                </label>
                <select
                  value={filterWard}
                  onChange={(e) => setFilterWard(e.target.value)}
                  className="w-full p-2 bg-slate-50 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="All">All Wards</option>
                  {WARDS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Report Issue */}
        {activeTab === "report" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col">
              <h2 className="font-bold text-slate-800 mb-1">
                1. Click Location on Map
              </h2>
              <p className="text-xs text-slate-500 mb-3">
                Reports of the same sub-category within 30m automatically merge
                into a Master Ticket.
              </p>
              <div className="h-[410px] w-full rounded-lg overflow-hidden border">
                <MapContainer
                  key="report-map"
                  center={[18.6517, 73.7686]}
                  zoom={12}
                  className="h-full w-full"
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <LocationMarker
                    position={selectedLocation}
                    setPosition={setSelectedLocation}
                  />
                </MapContainer>
              </div>
              {selectedLocation && (
                <p className="text-xs text-emerald-600 font-medium mt-2">
                  📍 Selected: {selectedLocation[0].toFixed(5)},{" "}
                  {selectedLocation[1].toFixed(5)}
                </p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <h2 className="font-bold text-slate-800 mb-3">
                2. Two-Tier Classification & Details
              </h2>

              {submitStatus && (
                <div
                  className={`p-3 rounded-lg text-xs mb-3 space-y-1 ${
                    submitStatus.type === "error"
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : submitStatus.type === "info"
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  <p className="font-semibold">{String(submitStatus.text)}</p>
                  {submitStatus.meta && (
                    <p className="text-[11px] opacity-90">
                      🤖 Gemini Triage: {submitStatus.meta}
                    </p>
                  )}
                </div>
              )}

              <form onSubmit={handleFormSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Main Category
                    </label>
                    <select
                      value={formData.mainCategory}
                      onChange={(e) => handleMainCategoryChange(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {Object.keys(TAXONOMY).map((main) => (
                        <option key={main} value={main}>
                          {main}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Sub-Category
                    </label>
                    <select
                      value={formData.subCategory}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          subCategory: e.target.value,
                        })
                      }
                      className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {(TAXONOMY[formData.mainCategory] || []).map((sub) => (
                        <option key={sub} value={sub}>
                          {sub}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Municipal Ward Routing
                  </label>
                  <select
                    value={formData.ward}
                    onChange={(e) =>
                      setFormData({ ...formData, ward: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {WARDS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Deep pothole near Akurdi station road"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Description
                  </label>
                  <textarea
                    required
                    rows="3"
                    placeholder="Provide details about the hazard..."
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  ></textarea>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Attach Photo (Triggers Gemini Visual Triage)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-lg text-sm shadow transition"
                >
                  {isSubmitting
                    ? "Running Triage & Submitting..."
                    : "Submit Civic Report"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: Citizen / Ward Leaderboard */}
        {activeTab === "leaderboard" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
              <div>
                <h2 className="font-bold text-slate-800 text-lg">
                  🏆 Ward Impact & Resolution Leaderboard
                </h2>
                <p className="text-xs text-slate-500">
                  Ranked by aggregated citizen reports (10 pts each) and
                  verified resolutions (+25 pts bonus).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs uppercase font-bold text-slate-500">
                    <th className="p-3">Rank</th>
                    <th className="p-3">Ward</th>
                    <th className="p-3">Master Tickets</th>
                    <th className="p-3">Total Reports</th>
                    <th className="p-3">Resolved</th>
                    <th className="p-3">Impact Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {leaderboardRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan="6"
                        className="p-6 text-center text-slate-400 text-xs"
                      >
                        No civic reports recorded yet.
                      </td>
                    </tr>
                  ) : (
                    leaderboardRows.map((row, index) => (
                      <tr key={row.ward} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-indigo-700">
                          #{index + 1}
                        </td>
                        <td className="p-3 font-semibold text-slate-800">
                          {row.ward}
                        </td>
                        <td className="p-3">{row.masterTickets}</td>
                        <td className="p-3">{row.totalReports}</td>
                        <td className="p-3 text-emerald-700 font-semibold">
                          {row.resolvedCount}
                        </td>
                        <td className="p-3 font-bold text-slate-900">
                          {row.points} pts
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: Management (3-Tier RBAC + Mandatory Resolution Proof) */}
        {activeTab === "management" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            {!adminToken ? (
              <div className="max-w-md mx-auto py-8">
                <div className="text-center mb-6">
                  <span className="text-4xl">🔒</span>
                  <h2 className="text-xl font-bold text-slate-800 mt-2">
                    Officer & Admin Portal
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Sign in with a Ward Officer or Super Admin account.
                  </p>
                </div>

                {loginError && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs font-medium mb-4 text-center">
                    {String(loginError)}
                  </div>
                )}

                <form
                  onSubmit={handleLogin}
                  className="space-y-4 bg-slate-50 p-6 rounded-xl border"
                >
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="admin or officer1"
                      value={loginCreds.username}
                      onChange={(e) =>
                        setLoginCreds({
                          ...loginCreds,
                          username: e.target.value,
                        })
                      }
                      className="w-full p-2.5 bg-white border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={loginCreds.password}
                      onChange={(e) =>
                        setLoginCreds({
                          ...loginCreds,
                          password: e.target.value,
                        })
                      }
                      className="w-full p-2.5 bg-white border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm shadow transition"
                  >
                    Sign In
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
                  <h2 className="font-bold text-slate-800 text-lg">
                    Incident Management & Proof Desk
                  </h2>
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-semibold">
                    Role: {adminRole} • Scope:{" "}
                    {adminWard === "ALL" ? "All Wards" : adminWard}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs uppercase font-bold text-slate-500">
                        <th className="p-3">Evidence</th>
                        <th className="p-3">Taxonomy & Ward</th>
                        <th className="p-3">Incident & AI Triage</th>
                        <th className="p-3">Dupes / Score</th>
                        <th className="p-3">Lifecycle & Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-sm">
                      {issues.map((issue) => {
                        const selectedStatus =
                          statusDrafts[issue._id] || issue.status;
                        return (
                          <tr
                            key={issue._id || String(Math.random())}
                            className="hover:bg-slate-50 align-top"
                          >
                            <td className="p-3 space-y-1.5">
                              {issue.imageUrl ? (
                                <img
                                  src={issue.imageUrl}
                                  alt={issue.title}
                                  className="w-12 h-12 object-cover rounded-lg border"
                                />
                              ) : (
                                <span className="text-xs text-slate-400 italic block">
                                  No report photo
                                </span>
                              )}
                              {issue.resolutionPhotoUrl && (
                                <div className="text-[10px] text-emerald-700 font-semibold">
                                  <img
                                    src={issue.resolutionPhotoUrl}
                                    alt="Resolution proof"
                                    className="w-12 h-12 object-cover rounded-lg border border-emerald-300"
                                  />
                                  <span>Proof</span>
                                </div>
                              )}
                            </td>

                            <td className="p-3 space-y-1">
                              <div className="text-xs font-bold text-indigo-700">
                                {issue.mainCategory || issue.category}
                              </div>
                              <div className="text-xs text-slate-700">
                                {issue.subCategory || issue.category}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {issue.ward || WARDS[0]}
                              </div>
                            </td>

                            <td className="p-3 max-w-xs space-y-1">
                              <div className="font-semibold text-slate-800">
                                {String(issue.title)}
                              </div>
                              <div className="text-xs text-slate-600 line-clamp-2">
                                {String(issue.description)}
                              </div>
                              {issue.aiTriage?.summary && (
                                <div className="text-[11px] text-purple-800 bg-purple-50 px-2 py-1 rounded border border-purple-100">
                                  Severity {issue.aiTriage.severityScore}/10:{" "}
                                  {issue.aiTriage.summary}
                                </div>
                              )}
                              {issue.resolvedAt && (
                                <div className="text-[11px] text-emerald-700">
                                  Resolved{" "}
                                  {new Date(issue.resolvedAt).toLocaleString()}
                                  {issue.resolvedBy
                                    ? ` by ${issue.resolvedBy}`
                                    : ""}
                                </div>
                              )}
                            </td>

                            <td className="p-3 text-xs space-y-1">
                              <div className="font-bold text-slate-800">
                                {issue.reportCount || 1}x merged
                              </div>
                              <div className="text-slate-500">
                                Score: {issue.priorityScore || 1}
                              </div>
                              <StatusBadge status={issue.status} />
                            </td>

                            <td className="p-3 space-y-2 min-w-[200px]">
                              <select
                                value={selectedStatus}
                                onChange={(e) =>
                                  setStatusDrafts((prev) => ({
                                    ...prev,
                                    [issue._id]: e.target.value,
                                  }))
                                }
                                className="w-full p-1.5 border rounded-lg text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                {LIFECYCLE_STEPS.map((st) => (
                                  <option key={st} value={st}>
                                    {st}
                                  </option>
                                ))}
                              </select>

                              {selectedStatus === "Resolved" && (
                                <div>
                                  <label className="block text-[10px] font-bold text-emerald-700 uppercase mb-0.5">
                                    Resolution Photo (Required)
                                  </label>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) =>
                                      setResolutionPhotos((prev) => ({
                                        ...prev,
                                        [issue._id]:
                                          e.target.files?.[0] || null,
                                      }))
                                    }
                                    className="w-full text-[11px] text-slate-600"
                                  />
                                </div>
                              )}

                              <button
                                type="button"
                                disabled={updatingId === issue._id}
                                onClick={() => handleSaveStatusUpdate(issue)}
                                className="w-full py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition"
                              >
                                {updatingId === issue._id
                                  ? "Saving..."
                                  : "Save Update"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
