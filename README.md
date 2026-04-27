# TomTom Traffic Visualization on Raspberry Pi

## Overview
This project is a data visualization system that uses TomTom traffic data to display real-time highway conditions on a Raspberry Pi-powered LED grid. The goal is to provide an intuitive, physical representation of traffic flow, making it easy to observe congestion patterns and movement across different highway segments.

The system processes live traffic data and maps it onto a grid-based display, where each section represents a portion of the highway network.

## Features
- Real-time traffic data integration using TomTom APIs  
- Visualization of highway segments on an LED grid  
- Interactive navigation using a joystick  
- Dynamic display updates reflecting current traffic conditions  

## Project Status
This project is actively evolving. We are currently exploring improvements to:
- Increase the granularity of the visualization  
- Enhance the display format and readability  
- Support recorded datasets for demonstration purposes  
- Improve how user interaction and contextual information are presented  

These features are still under consideration and may change as development continues.

## How It Works
- The Raspberry Pi connects to a traffic data source  
- Data is processed and mapped to a grid layout  
- Each section of the grid represents a segment of the highway  
- A joystick allows users to navigate between segments and view details  

## Getting Started

### Prerequisites
- Raspberry Pi (with LED grid and joystick setup)
- Node.js and npm installed
- Network access to connect to the Raspberry Pi

### Running the project
npm start
