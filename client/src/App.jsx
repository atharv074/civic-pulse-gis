import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";

// Fix Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const API_BASE = "https://civic-pulse-gis.onrender.com/api";

// Map Click Listener Component
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

export default function App() {
  const [activeTab, setActiveTab] = useState("explore");
  const [issues, setIssues] = useState([]);
  const [filterCategory, setFilterCategory] = useState("All");

  // Auth state
  const [adminToken, setAdminToken] = useState(
    localStorage.getItem("adminToken") || "",
  );
  const [adminUser, setAdminUser] = useState(
    localStorage.getItem("adminUser") || "",
  );
  const [loginCreds, setLoginCreds] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");

  // Form State
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "Pothole",
  });
  const [file, setFile] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [submitStatus, setSubmitStatus] = useState("");

  useEffect(() => {
    fetchIssues();
  }, []);

  const fetchIssues = async () => {
    try {
      const response = await axios.get(`${API_BASE}/issues`);
      setIssues(response.data);
    } catch (err) {
      console.error("Error fetching issues:", err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await axios.post(`${API_BASE}/admin/login`, loginCreds);
      setAdminToken(res.data.token);
      setAdminUser(res.data.username);
      localStorage.setItem("adminToken", res.data.token);
      localStorage.setItem("adminUser", res.data.username);
      setLoginCreds({ username: "", password: "" });
    } catch (err) {
      setLoginError(err.response?.data?.error || "Login failed");
    }
  };

  const handleLogout = () => {
    setAdminToken("");
    setAdminUser("");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!selectedLocation) {
      alert("Please click on the map to set an issue location!");
      return;
    }

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("title", formData.title);
      formDataToSend.append("description", formData.description);
      formDataToSend.append("category", formData.category);
      formDataToSend.append("latitude", selectedLocation[0]);
      formDataToSend.append("longitude", selectedLocation[1]);
      if (file) {
        formDataToSend.append("image", file);
      }

      await axios.post(`${API_BASE}/issues`, formDataToSend, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSubmitStatus("Issue reported successfully!");
      setFormData({ title: "", description: "", category: "Pothole" });
      setFile(null);
      setSelectedLocation(null);
      fetchIssues();
    } catch (err) {
      console.error("Error submitting issue:", err);
      setSubmitStatus("Failed to submit issue. Please try again.");
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await axios.patch(
        `${API_BASE}/issues/${id}`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      fetchIssues();
    } catch (err) {
      alert(
        err.response?.data?.error ||
          "Failed to update status. Please log in again.",
      );
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
    }
  };

  const filteredIssues =
    filterCategory === "All"
      ? issues
      : issues.filter((issue) => issue.category === filterCategory);

  const stats = {
    total: issues.length,
    pending: issues.filter((i) => i.status === "Pending").length,
    inProgress: issues.filter((i) => i.status === "In Progress").length,
    resolved: issues.filter((i) => i.status === "Resolved").length,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Navbar */}
      <header className="bg-indigo-700 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🛡️</span>
            <h1 className="text-xl font-bold tracking-wide">Civic Pulse GIS</h1>
          </div>
          <div className="flex items-center space-x-3">
            <nav className="flex space-x-1 bg-indigo-800 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab("explore")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "explore" ? "bg-white text-indigo-700 shadow" : "text-indigo-100 hover:bg-indigo-600"}`}
              >
                Explore Map
              </button>
              <button
                onClick={() => setActiveTab("report")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "report" ? "bg-white text-indigo-700 shadow" : "text-indigo-100 hover:bg-indigo-600"}`}
              >
                Report Issue
              </button>
              <button
                onClick={() => setActiveTab("management")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "management" ? "bg-white text-indigo-700 shadow" : "text-indigo-100 hover:bg-indigo-600"}`}
              >
                Management
              </button>
            </nav>

            {adminToken && (
              <div className="flex items-center space-x-2 bg-indigo-900 px-3 py-1.5 rounded-lg text-xs">
                <span>
                  👨‍💼 Admin: <strong>{adminUser}</strong>
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

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col gap-4">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Total Reported
              </p>
              <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            </div>
            <span className="text-2xl text-blue-500">📊</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Pending Action
              </p>
              <p className="text-2xl font-bold text-amber-600">
                {stats.pending}
              </p>
            </div>
            <span className="text-2xl text-amber-500">⚠️</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                In Progress
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
                Resolved
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
            <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-100 p-2 h-[500px]">
              <MapContainer
                center={[18.5204, 73.8567]}
                zoom={12}
                className="h-full w-full rounded-lg"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {filteredIssues.map((issue) => (
                  <Marker
                    key={issue._id}
                    position={[
                      issue.location.coordinates[1],
                      issue.location.coordinates[0],
                    ]}
                  >
                    <Popup>
                      <div className="p-1 max-w-[200px]">
                        {issue.imageUrl && (
                          <img
                            src={issue.imageUrl}
                            alt={issue.title}
                            className="w-full h-28 object-cover rounded-lg mb-2 border border-slate-200"
                          />
                        )}
                        <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold">
                          {issue.category}
                        </span>
                        <h3 className="font-bold text-sm mt-1 text-slate-800">
                          {issue.title}
                        </h3>
                        <p className="text-xs text-slate-600 mt-1">
                          {issue.description}
                        </p>
                        <p className="text-xs mt-2 font-semibold">
                          Status:{" "}
                          <span
                            className={
                              issue.status === "Resolved"
                                ? "text-emerald-600"
                                : issue.status === "In Progress"
                                  ? "text-blue-600"
                                  : "text-amber-600"
                            }
                          >
                            {issue.status}
                          </span>
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            {/* Sidebar Filter */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <h2 className="font-bold text-slate-800 mb-3">
                Filter Incidents
              </h2>
              <div className="flex flex-col gap-2">
                {[
                  "All",
                  "Pothole",
                  "Streetlight",
                  "Garbage",
                  "Water Leakage",
                  "Other",
                ].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition ${
                      filterCategory === cat
                        ? "bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-600"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
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
                Click on the map to mark the exact location of the civic issue.
              </p>
              <div className="h-[380px] w-full rounded-lg overflow-hidden border">
                <MapContainer
                  center={[18.5204, 73.8567]}
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
                2. Fill Report Details
              </h2>
              {submitStatus && (
                <div
                  className={`p-3 rounded-lg text-sm mb-3 ${submitStatus.includes("successfully") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
                >
                  {submitStatus}
                </div>
              )}
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Pothole">Pothole</option>
                    <option value="Streetlight">Streetlight</option>
                    <option value="Garbage">Garbage</option>
                    <option value="Water Leakage">Water Leakage</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Broken streetlight on main road"
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
                    placeholder="Provide details about the issue..."
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full p-2.5 bg-slate-50 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  ></textarea>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Attach Photo (Optional)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFile(e.target.files[0])}
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm shadow transition"
                >
                  Submit Civic Report
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: Management */}
        {activeTab === "management" && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            {!adminToken ? (
              /* ADMIN LOGIN FORM */
              <div className="max-w-md mx-auto py-8">
                <div className="text-center mb-6">
                  <span className="text-4xl">🔒</span>
                  <h2 className="text-xl font-bold text-slate-800 mt-2">
                    Municipal Admin Portal
                  </h2>
                  <p className="text-xs text-slate-500">
                    Log in to manage civic reports and update resolution
                    statuses.
                  </p>
                </div>

                {loginError && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs font-medium mb-4 text-center">
                    {loginError}
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
                      placeholder="admin"
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
                    Log In as Admin
                  </button>
                  <p className="text-xs text-slate-400 text-center mt-2">
                    Default Credentials — User: <strong>admin</strong> | Pass:{" "}
                    <strong>admin123</strong>
                  </p>
                </form>
              </div>
            ) : (
              /* ADMIN MANAGEMENT DESK */
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-bold text-slate-800 text-lg">
                    Admin Management Desk
                  </h2>
                  <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-3 py-1 rounded-full">
                    Authenticated Admin Session Active
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs uppercase font-bold text-slate-500">
                        <th className="p-3">Photo</th>
                        <th className="p-3">Category</th>
                        <th className="p-3">Title</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Date</th>
                        <th className="p-3">Status Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-sm">
                      {issues.map((issue) => (
                        <tr key={issue._id} className="hover:bg-slate-50">
                          <td className="p-3">
                            {issue.imageUrl ? (
                              <a
                                href={issue.imageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <img
                                  src={issue.imageUrl}
                                  alt={issue.title}
                                  className="w-10 h-10 object-cover rounded-lg hover:scale-110 transition-transform border"
                                />
                              </a>
                            ) : (
                              <span className="text-xs text-slate-400 italic">
                                No photo
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="text-xs px-2 py-1 rounded bg-slate-100 font-semibold text-slate-700">
                              {issue.category}
                            </span>
                          </td>
                          <td className="p-3 font-semibold text-slate-800">
                            {issue.title}
                          </td>
                          <td className="p-3 text-slate-600 max-w-xs truncate">
                            {issue.description}
                          </td>
                          <td className="p-3 text-xs text-slate-400">
                            {new Date(issue.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-3">
                            <select
                              value={issue.status}
                              onChange={(e) =>
                                handleStatusChange(issue._id, e.target.value)
                              }
                              className="p-1.5 border rounded-lg text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            >
                              <option value="Pending">⚠️ Pending</option>
                              <option value="In Progress">
                                🕒 In Progress
                              </option>
                              <option value="Resolved">✅ Resolved</option>
                            </select>
                          </td>
                        </tr>
                      ))}
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
