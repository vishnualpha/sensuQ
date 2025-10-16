const PDFLib = require('pdf-lib');
const fs = require('fs').promises;

async function generatePDFReport(testRun, testCases) {
  try {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const timesRomanFont = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
    const timesRomanBoldFont = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold);
    
    let currentPage = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = currentPage.getSize();
    const margin = 50;
    const contentWidth = width - (margin * 2);
    
    let yPosition = height - margin;
    const lineHeight = 15;
    const titleFontSize = 20;
    const headerFontSize = 16;
    const subHeaderFontSize = 14;
    const fontSize = 11;
    
    // Helper function to add new page if needed
    const checkPageSpace = (requiredSpace) => {
      if (yPosition - requiredSpace < margin) {
        currentPage = pdfDoc.addPage([612, 792]);
        yPosition = height - margin;
        return true;
      }
      return false;
    };
    
    // Helper function to draw text with word wrapping
    const drawWrappedText = (text, x, y, maxWidth, font, size) => {
      const words = text.split(' ');
      let lines = [];
      let currentLine = '';
      
      for (const word of words) {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const testWidth = font.widthOfTextAtSize(testLine, size);
        
        if (testWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);
      
      let currentY = y;
      for (const line of lines) {
        checkPageSpace(lineHeight);
        currentPage.drawText(line, { x, y: currentY, size, font });
        currentY -= lineHeight;
        yPosition = currentY;
      }
      
      return currentY;
    };
    
    // Title
    currentPage.drawText('SensuQ Autonomous Testing Engine', {
      x: margin,
      y: yPosition,
      size: titleFontSize,
      font: timesRomanBoldFont,
    });
    yPosition -= 30;
    
    currentPage.drawText('Comprehensive Test Execution Report', {
      x: margin,
      y: yPosition,
      size: headerFontSize,
      font: timesRomanFont,
    });
    yPosition -= 40;
    
    // Test Run Information Section
    checkPageSpace(100);
    currentPage.drawText('Test Run Information', {
      x: margin,
      y: yPosition,
      size: subHeaderFontSize,
      font: timesRomanBoldFont,
    });
    yPosition -= 25;
    
    const runInfo = [
      `Configuration Name: ${testRun.config_name}`,
      `Target URL: ${testRun.target_url}`,
      `Test Run ID: ${testRun.id}`,
      `Status: ${testRun.status.toUpperCase()}`,
      `Start Time: ${new Date(testRun.start_time).toLocaleString()}`,
      `End Time: ${testRun.end_time ? new Date(testRun.end_time).toLocaleString() : 'N/A'}`,
      `Duration: ${testRun.end_time ? 
        Math.round((new Date(testRun.end_time) - new Date(testRun.start_time)) / 60000) + ' minutes' : 
        'N/A'}`
    ];
    
    for (const info of runInfo) {
      checkPageSpace(lineHeight);
      currentPage.drawText(info, {
        x: margin,
        y: yPosition,
        size: fontSize,
        font: timesRomanFont,
      });
      yPosition -= lineHeight;
    }
    yPosition -= 20;
    
    // Summary Statistics Section
    checkPageSpace(150);
    currentPage.drawText('Test Execution Summary', {
      x: margin,
      y: yPosition,
      size: subHeaderFontSize,
      font: timesRomanBoldFont,
    });
    yPosition -= 25;
    
    const stats = [
      `Total Pages Discovered: ${testRun.total_pages_discovered || 0}`,
      `Total Test Cases Generated: ${testRun.total_test_cases || 0}`,
      `Passed Tests: ${testRun.passed_tests || 0}`,
      `Failed Tests: ${testRun.failed_tests || 0}`,
      `Flaky Tests: ${testRun.flaky_tests || 0}`,
      `Overall Coverage: ${Math.round(testRun.coverage_percentage || 0)}%`,
      `Success Rate: ${testRun.total_test_cases ? 
        Math.round(((testRun.passed_tests || 0) / testRun.total_test_cases) * 100) : 0}%`
    ];
    
    for (const stat of stats) {
      checkPageSpace(lineHeight);
      currentPage.drawText(stat, {
        x: margin,
        y: yPosition,
        size: fontSize,
        font: timesRomanFont,
      });
      yPosition -= lineHeight;
    }
    yPosition -= 30;
    
    // Test Cases Details Section
    checkPageSpace(50);
    currentPage.drawText('Detailed Test Cases', {
      x: margin,
      y: yPosition,
      size: subHeaderFontSize,
      font: timesRomanBoldFont,
    });
    yPosition -= 25;
    
    // Group test cases by type
    const testCasesByType = {};
    testCases.forEach(testCase => {
      const type = testCase.test_type || 'unknown';
      if (!testCasesByType[type]) testCasesByType[type] = [];
      testCasesByType[type].push(testCase);
    });
    
    for (const [type, cases] of Object.entries(testCasesByType)) {
      checkPageSpace(30);
      currentPage.drawText(`${type.toUpperCase()} Tests (${cases.length})`, {
        x: margin,
        y: yPosition,
        size: fontSize + 1,
        font: timesRomanBoldFont,
      });
      yPosition -= 20;
      
      for (const testCase of cases) {
        checkPageSpace(80);
        
        // Test case name and status
        const statusColor = testCase.status === 'passed' ? [0, 0.7, 0] : 
                           testCase.status === 'failed' ? [0.7, 0, 0] : [0.7, 0.7, 0];
        
        currentPage.drawText(`• ${testCase.test_name}`, {
          x: margin + 10,
          y: yPosition,
          size: fontSize,
          font: timesRomanBoldFont,
        });
        
        currentPage.drawText(`[${testCase.status.toUpperCase()}]`, {
          x: margin + 10 + timesRomanBoldFont.widthOfTextAtSize(`• ${testCase.test_name} `, fontSize),
          y: yPosition,
          size: fontSize,
          font: timesRomanBoldFont,
          color: PDFLib.rgb(...statusColor),
        });
        yPosition -= lineHeight;
        
        // Test description
        if (testCase.test_description) {
          yPosition = drawWrappedText(
            `Description: ${testCase.test_description}`,
            margin + 20,
            yPosition,
            contentWidth - 20,
            timesRomanFont,
            fontSize - 1
          );
          yPosition -= 5;
        }
        
        // Expected result
        if (testCase.expected_result) {
          yPosition = drawWrappedText(
            `Expected: ${testCase.expected_result}`,
            margin + 20,
            yPosition,
            contentWidth - 20,
            timesRomanFont,
            fontSize - 1
          );
          yPosition -= 5;
        }
        
        // Actual result (if executed)
        if (testCase.actual_result) {
          let actualText = testCase.actual_result;
          try {
            const parsed = JSON.parse(actualText);
            if (Array.isArray(parsed)) {
              actualText = parsed.map(r => `${r.browser}: ${r.status}`).join(', ');
            }
          } catch (e) {
            // Use as is if not JSON
          }
          
          yPosition = drawWrappedText(
            `Actual: ${actualText}`,
            margin + 20,
            yPosition,
            contentWidth - 20,
            timesRomanFont,
            fontSize - 1
          );
          yPosition -= 5;
        }
        
        // Execution details
        if (testCase.execution_time) {
          currentPage.drawText(`Execution Time: ${testCase.execution_time}ms`, {
            x: margin + 20,
            y: yPosition,
            size: fontSize - 1,
            font: timesRomanFont,
          });
          yPosition -= lineHeight;
        }
        
        if (testCase.self_healed) {
          currentPage.drawText('✓ Self-healed during execution', {
            x: margin + 20,
            y: yPosition,
            size: fontSize - 1,
            font: timesRomanFont,
            color: PDFLib.rgb(0, 0.5, 0.8),
          });
          yPosition -= lineHeight;
        }
        
        // Error details (if failed)
        if (testCase.error_details) {
          yPosition = drawWrappedText(
            `Error: ${testCase.error_details}`,
            margin + 20,
            yPosition,
            contentWidth - 20,
            timesRomanFont,
            fontSize - 1
          );
          yPosition -= 5;
        }
        
        yPosition -= 10; // Space between test cases
      }
      
      yPosition -= 15; // Space between test types
    }
    
    // Footer on last page
    checkPageSpace(50);
    yPosition = margin + 30;
    currentPage.drawText(`Generated on: ${new Date().toLocaleString()}`, {
      x: margin,
      y: yPosition,
      size: fontSize - 1,
      font: timesRomanFont,
      color: PDFLib.rgb(0.5, 0.5, 0.5),
    });
    
    currentPage.drawText('SensuQ Autonomous Testing Engine - Comprehensive Test Report', {
      x: margin,
      y: yPosition - 15,
      size: fontSize - 1,
      font: timesRomanFont,
      color: PDFLib.rgb(0.5, 0.5, 0.5),
    });
    
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
    
  } catch (error) {
    console.error('Error generating PDF report:', error);
    throw error;
  }
}

function generateJSONReport(testRun, discoveredPages, testCases) {
  return {
    reportMetadata: {
      generatedAt: new Date().toISOString(),
      reportVersion: '1.0',
      toolName: 'SensuQ Autonomous Testing Engine',
      reportType: 'Comprehensive Test Execution Report'
    },
    testRun: {
      id: testRun.id,
      configName: testRun.config_name,
      targetUrl: testRun.target_url,
      status: testRun.status,
      startTime: testRun.start_time,
      endTime: testRun.end_time,
      duration: testRun.end_time ? 
        Math.round((new Date(testRun.end_time) - new Date(testRun.start_time)) / 60000) : null,
      statistics: {
        totalPagesDiscovered: testRun.total_pages_discovered || 0,
        totalTestCases: testRun.total_test_cases || 0,
        passedTests: testRun.passed_tests || 0,
        failedTests: testRun.failed_tests || 0,
        flakyTests: testRun.flaky_tests || 0,
        coveragePercentage: testRun.coverage_percentage || 0,
        successRate: testRun.total_test_cases ? 
          Math.round(((testRun.passed_tests || 0) / testRun.total_test_cases) * 100) : 0
      }
    },
    discoveredPages: discoveredPages.map(page => ({
      id: page.id,
      url: page.url,
      title: page.title,
      elementsCount: page.elements_count,
      crawlDepth: page.crawl_depth,
      discoveredAt: page.discovered_at,
      screenshotPath: page.screenshot_path
    })),
    testCases: testCases.map(testCase => {
      let parsedSteps = [];
      let parsedActualResult = null;
      
      try {
        parsedSteps = typeof testCase.test_steps === 'string' ? 
          JSON.parse(testCase.test_steps) : testCase.test_steps || [];
      } catch (e) {
        parsedSteps = [];
      }
      
      try {
        parsedActualResult = typeof testCase.actual_result === 'string' ? 
          JSON.parse(testCase.actual_result) : testCase.actual_result;
      } catch (e) {
        parsedActualResult = testCase.actual_result;
      }
      
      return {
        id: testCase.id,
        testType: testCase.test_type,
        testName: testCase.test_name,
        testDescription: testCase.test_description,
        testSteps: parsedSteps,
        expectedResult: testCase.expected_result,
        actualResult: parsedActualResult,
        status: testCase.status,
        executionTime: testCase.execution_time,
        selfHealed: testCase.self_healed,
        errorDetails: testCase.error_details,
        executedAt: testCase.executed_at,
        pageId: testCase.page_id
      };
    }),
    summary: {
      testCasesByType: testCases.reduce((acc, testCase) => {
        const type = testCase.test_type || 'unknown';
        if (!acc[type]) acc[type] = { total: 0, passed: 0, failed: 0, flaky: 0 };
        acc[type].total++;
        if (testCase.status === 'passed') acc[type].passed++;
        else if (testCase.status === 'failed') acc[type].failed++;
        else if (testCase.status === 'flaky') acc[type].flaky++;
        return acc;
      }, {}),
      pagesCrawledByDepth: discoveredPages.reduce((acc, page) => {
        const depth = page.crawl_depth || 0;
        acc[depth] = (acc[depth] || 0) + 1;
        return acc;
      }, {}),
      executionMetrics: {
        averageExecutionTime: testCases.length > 0 ? 
          Math.round(testCases.reduce((sum, tc) => sum + (tc.execution_time || 0), 0) / testCases.length) : 0,
        selfHealedTests: testCases.filter(tc => tc.self_healed).length,
        totalExecutionTime: testCases.reduce((sum, tc) => sum + (tc.execution_time || 0), 0)
      }
    }
  };
}

module.exports = { generatePDFReport, generateJSONReport };