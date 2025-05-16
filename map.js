import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Helper: format minutes as HH:MM AM/PM
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Helper: minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper: filter trips by time (within 60 min of slider)
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Compute station traffic (arrivals, departures, totalTraffic)
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

mapboxgl.accessToken = 'pk.eyJ1Ijoib2c4N3RvbnkiLCJhIjoiY21hcTFoZDAwMDRvNTJpb242emo3MjdwYyJ9.VxJNCDJeyiQRA-iSTUdnyA';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  // Load station data
  let jsonData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = jsonData.data.stations;

  // Load trip data, parsing dates
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    }
  );

  // Initial traffic computation
  stations = computeStationTraffic(stations, trips);

  // D3 scale for circle radii
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Ensure SVG exists
  let svg = d3.select('#map').select('svg');
  if (svg.empty()) {
    svg = d3
      .select('#map')
      .append('svg')
      .style('position', 'absolute')
      .style('top', 0)
      .style('left', 0)
      .attr('width', '100%')
      .attr('height', '100%');
  }

  // Project station coordinates
  function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
  }

  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  // Draw circles with key function
  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .each(function (d) {
        // Add <title> for browser tooltips
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      })
      .selectAll('circle')
    // previous code implemented ommitted for brevity
    .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
    );

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Slider and display elements
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Update scatterplot according to time filter
  function updateScatterPlot(timeFilter) {
    // Filter trips by time
    const filteredTrips = filterTripsbyTime(trips, timeFilter);

    // Recompute station traffic
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // Update scale range depending on filter
    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    // Update circles with key function
    circles = svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8).style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );

    updatePositions();
  }

  // Update time display and call updateScatterPlot
  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
      selectedTime.style.display = 'none';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
      selectedTime.style.display = 'block';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
