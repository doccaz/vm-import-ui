// frontend/src/App.test.js
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

// Mock fetch globally
beforeEach(() => {
    global.fetch = jest.fn((url) => {
        if (url.includes('/api/v1/capabilities')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    harvesterVersion: '1.6.0',
                    hasAdvancedPower: true,
                    hasForklift: true,
                }),
            });
        }
        if (url.includes('/api/v1/forklift/availability')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ available: true }),
            });
        }
        // Default: return empty array for all list endpoints
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
        });
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('App', () => {
    test('renders the main dashboard with Migration Plans tab', async () => {
        render(<App />);
        await waitFor(() => {
            expect(screen.getByText('Migration Plans')).toBeInTheDocument();
        });
    });

    test('renders all navigation tabs', async () => {
        render(<App />);
        await waitFor(() => {
            expect(screen.getByText('Migration Plans')).toBeInTheDocument();
            expect(screen.getByText('vCenter Sources')).toBeInTheDocument();
            expect(screen.getByText('OVA Sources')).toBeInTheDocument();
            expect(screen.getByText('About')).toBeInTheDocument();
        });
    });

    test('switches to vCenter Sources tab', async () => {
        render(<App />);
        await waitFor(() => {
            fireEvent.click(screen.getByText('vCenter Sources'));
        });
        await waitFor(() => {
            // The sources page has subtabs for VM Import Controller and Forklift
            expect(screen.getByText('VM Import Controller')).toBeInTheDocument();
            expect(screen.getByText('Forklift')).toBeInTheDocument();
        });
    });

    test('switches to Forklift subtab and shows providers', async () => {
        render(<App />);
        await waitFor(() => {
            fireEvent.click(screen.getByText('vCenter Sources'));
        });
        await waitFor(() => {
            fireEvent.click(screen.getByText('Forklift'));
        });
        await waitFor(() => {
            expect(screen.getByText('Forklift vSphere Providers')).toBeInTheDocument();
        });
    });

    test('OVA Sources tab has Forklift subtab', async () => {
        render(<App />);
        await waitFor(() => {
            fireEvent.click(screen.getByText('OVA Sources'));
        });
        await waitFor(() => {
            // OVA Sources page should have subtabs
            expect(screen.getByText('VM Import Controller')).toBeInTheDocument();
            expect(screen.getByText('Forklift')).toBeInTheDocument();
        });
        // Switch to Forklift subtab
        await waitFor(() => {
            fireEvent.click(screen.getByText('Forklift'));
        });
        await waitFor(() => {
            expect(screen.getByText('Forklift OVA Providers')).toBeInTheDocument();
        });
    });

    test('switches to About page', async () => {
        render(<App />);
        await waitFor(() => {
            fireEvent.click(screen.getByText('About'));
        });
        await waitFor(() => {
            expect(screen.getByText('About VM Import UI')).toBeInTheDocument();
        });
    });
});
