# server.py
import os
import googlemaps
import requests
import polyline
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from math import radians, sin, cos, sqrt, atan2

load_dotenv()
app = Flask(__name__)

# --- Configuration ---
GOOGLE_FRONTEND_KEY = os.getenv("GOOGLE_FRONTEND_KEY")
GOOGLE_BACKEND_KEY = os.getenv("GOOGLE_BACKEND_KEY")
OWM_KEY = os.getenv("OWM_KEY")
gmaps = googlemaps.Client(key=GOOGLE_BACKEND_KEY)

# --- Helper Functions (No changes needed here) ---
def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1_rad, lon1_rad, lat2_rad, lon2_rad = map(radians, [lat1, lon1, lat2, lon2])
    dlon = lon2_rad - lon1_rad
    dlat = lat2_rad - lat1_rad
    a = sin(dlat / 2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(dlon / 2)**2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return R * c

def get_weather_at_point(lat, lon):
    try:
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_KEY}&units=metric"
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        return {
            "city": data.get("name", "Unknown area"),
            "temp": data["main"]["temp"],
            "humidity": data["main"]["humidity"],
            "wind": data["wind"]["speed"],
            "description": data["weather"][0]["description"].title(),
            "icon": f"https://openweathermap.org/img/wn/{data['weather'][0]['icon']}@2x.png",
            "coords": {"lat": lat, "lng": lon}
        }
    except requests.exceptions.RequestException as e:
        print(f"Error fetching weather: {e}")
        return None

# --- Flask Routes ---
@app.route("/")
def index():
    return render_template("index.html", google_key=GOOGLE_FRONTEND_KEY)

@app.route("/route-data", methods=["POST"])
def get_route_data():
    data = request.get_json()
    start = data.get("start")
    destination = data.get("destination")
    # ---> ADDED: Get the list of waypoints <---
    waypoints = data.get("waypoints", [])

    if not start or not destination:
        return jsonify({"error": "Start and destination are required"}), 400

    try:
        # ---> UPDATED: Pass waypoints to the directions call <---
        directions_result = gmaps.directions(start,
                                             destination,
                                             waypoints=waypoints,
                                             optimize_waypoints=True,
                                             mode="driving")
        if not directions_result:
            return jsonify({"error": "No route found"}), 404

        encoded_polyline = directions_result[0]['overview_polyline']['points']
        decoded_coords = polyline.decode(encoded_polyline)

        weather_points = []
        sampled_points = []
        distance_threshold_km = 50.0
        last_sample_coord = None

        if decoded_coords:
            sampled_points.append(decoded_coords[0])
            last_sample_coord = decoded_coords[0]

        for coord in decoded_coords:
            distance = haversine(last_sample_coord[0], last_sample_coord[1], coord[0], coord[1])
            if distance >= distance_threshold_km:
                sampled_points.append(coord)
                last_sample_coord = coord

        for lat, lon in sampled_points:
            weather_data = get_weather_at_point(lat, lon)
            if weather_data:
                weather_points.append(weather_data)
        
        return jsonify({
            "route": directions_result[0],
            "weather": weather_points
        })

    except Exception as e:
        print(f"An error occurred: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)