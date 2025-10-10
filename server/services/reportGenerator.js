const PDFLib = require('pdf-lib');
const fs = require('fs').promises;

async function generatePDFReport(testRun, testCases) {
  try {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Letter size
    
    const { width, height } = page.getSize();
    const fontSize = 12;
    const titleFontSize = 18;
    const headerFontSize = 14;
    
    let yPosition = height - 50;
    
    // Title
    page.drawText('SensuQ Test Execution Report', {
      x: 50,
      y: yPosition,
      size: titleFontSize,
    });
    
    yPosition -= 40;
    
    // Test Run Information
    page.drawText(`Configuration: ${testRun.config_name}`, {
      x: 50,
      y: yPosition,
      size: fontSize,
    });
    
    yPosition -= 20;
    
    page.drawText(`Target URL: ${testRun.target_url}`, {
      x: 50,
      y: yPosition,
      size: fontSize,
    });
    
    yPosition -= 20;
    
    page.drawText(`Execution Time: ${testRun.start_time} - ${testRun.end_time || 'Running'}`, {
      x: 50,
      y: yPosition,
      size: fontSize,
    });
    
    yPosition -= 30;
    
    // Summary Statistics
    page.drawText('Test Summary', {
      x: 50,
      y: yPosition,
      size: headerFontSize,
    });
    
    yPosition -= 25;
    
    const stats = [
      `Total Pages Discovered: ${testRun.total_pages_discovered || 0}`,
      `Total Test Cases: ${testRun.total_test_cases || 0}`,
      `Passed Tests: ${testRun.passed_tests || 0}`,
      `Failed Tests: ${testRun.failed_tests || 0}`,
      `Flaky Tests: ${testRun.flaky_tests || 0}`,
      `Coverage: ${testRun.coverage_percentage || 0}%`
    ];
    
    for (const stat of stats) {
      page.drawText(stat, {
        x: 50,
        y: yPosition,
        size: fontSize,
      });
      yPosition -= 18;
    }
    
    yPosition -= 20;
    
    // Test Cases Details
    page.drawText('Test Cases', {
      x: 50,
      y: yPosition,
      size: headerFontSize,
    });
    
    yPosition -= 25;
    
    for (const testCase of testCases.slice(0, 20)) { // Limit to first 20 test cases
      if (yPosition < 100) {
        // Add new page if needed
        const newPage = pdfDoc.addPage([612, 792]);
        yPosition = height - 50;
      }
      
      page.drawText(`${testCase.test_name} - ${testCase.status.toUpperCase()}`, {
        x: 50,
        y: yPosition,
        size: fontSize,
      });
      
      yPosition -= 15;
      
      if (testCase.test_description) {
        page.drawText(testCase.test_description.substring(0, 80) + '...', {
          x: 70,
          y: yPosition,
          size: fontSize - 2,
        });
        yPosition -= 15;
      }
      
      yPosition -= 10;
    }
    
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
    
  } catch (error) {
    console.error('Error generating PDF report:', error);
    throw error;
  }
}

function generateJSONReport(testRun, discoveredPages, testCases) {
  return {
    testRun: {
      id: testRun.id,
      configName: testRun.config_name,
      targetUrl: testRun.target_url,
      status: testRun.status,
      startTime: testRun.start_time,
      endTime: testRun.end_time,
      statistics: {
        totalPagesDiscovered: testRun.total_pages_discovered || 0,
        totalTestCases: testRun.total_test_cases || 0,
        passedTests: testRun.passed_tests || 0,
        failedTests: testRun.failed_tests || 0,
        flakyTests: testRun.flaky_tests || 0,
        coveragePercentage: testRun.coverage_percentage || 0
      }
    },
    discoveredPages: discoveredPages.map(page => ({
      id: page.id,
      url: page.url,
      title: page.title,
      elementsCount: page.elements_count,
      crawlDepth: page.crawl_depth,
      discoveredAt: page.discovered_at
    })),
    testCases: testCases.map(testCase => ({
      id: testCase.id,
      testType: testCase.test_type,
      testName: testCase.test_name,
      testDescription: testCase.test_description,
      status: testCase.status,
      executionTime: testCase.execution_time,
      selfHealed: testCase.self_healed,
      executedAt: testCase.executed_at,
      errorDetails: testCase.error_details
    })),
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generatePDFReport, generateJSONReport };