import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface Screenshot {
  src: string;
  alt: string;
  description?: string;
  step?: string;
  action?: string;
}

interface ScreenshotModalProps {
  screenshots: Screenshot[];
  initialIndex?: number;
  onClose: () => void;
}

export default function ScreenshotModal({ screenshots, initialIndex = 0, onClose }: ScreenshotModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const currentScreenshot = screenshots[currentIndex];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') handlePrevious();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === ' ') {
        e.preventDefault();
        togglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, isPlaying]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && screenshots.length > 1) {
      interval = setInterval(() => {
        setCurrentIndex((prev) => {
          const next = prev + 1;
          if (next >= screenshots.length) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, screenshots.length]);

  const handleNext = () => {
    if (currentIndex < screenshots.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setZoom(1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setZoom(1);
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  const togglePlayback = () => {
    if (screenshots.length > 1) {
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90" onClick={onClose}>
      <div className="relative w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-black bg-opacity-50 text-white">
          <div className="flex-1">
            <h3 className="text-lg font-medium">{currentScreenshot.alt}</h3>
            {currentScreenshot.description && (
              <p className="text-sm text-gray-300">{currentScreenshot.description}</p>
            )}
            {currentScreenshot.step && (
              <p className="text-xs text-gray-400 mt-1">Step: {currentScreenshot.step}</p>
            )}
            {currentScreenshot.action && (
              <p className="text-xs text-gray-400">Action: {currentScreenshot.action}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-300">
              {currentIndex + 1} / {screenshots.length}
            </span>
          </div>
        </div>

        {/* Image Container */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <img
            src={currentScreenshot.src}
            alt={currentScreenshot.alt}
            className="max-w-full max-h-full object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between p-4 bg-black bg-opacity-50">
          <div className="flex items-center space-x-2">
            {/* Navigation */}
            {screenshots.length > 1 && (
              <>
                <button
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                  className="p-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
                  title="Previous (←)"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={togglePlayback}
                  className="px-4 py-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition-colors"
                  title="Play/Pause (Space)"
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={handleNext}
                  disabled={currentIndex === screenshots.length - 1}
                  className="p-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
                  title="Next (→)"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* Zoom Controls */}
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              className="p-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-3 py-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 text-white text-sm transition-colors"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              className="p-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition-colors"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
